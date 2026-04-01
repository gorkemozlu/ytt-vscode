const { execFile } = require('child_process');
const vscode = require('vscode');

const YTT_MARKER =
    /(^|[ \t])#@|(^|[ \t])#!|\(@|#@(?:overlay|data\/values|schema|yaml)\//m;
const YTT_COMMENT_PATTERN = /^\s*#!.*$/;
const PLAIN_YAML_COMMENT_PATTERN = /^\s*#(?![!@]).*$/;
const YTT_ANNOTATION_PATTERN = /^\s*#@(overlay|yaml|data|schema)(\/[\w-]+)+\b/;
const YTT_DEFINITION_PATTERN = /^\s*#@\s*def\b/;
const YTT_DIRECTIVE_PATTERN = /^\s*#@\s*(if\/end|for\/end|if|elif|else|for|def|end|load|return|yaml)\b/;
const YTT_OPEN_PATTERN = /^\s*#@\s*(if|for|def)\b/;
const YTT_BRANCH_PATTERN = /^\s*#@\s*(elif|else)\b/;
const YTT_END_PATTERN = /^\s*#@\s*end\b/;
const YTT_SINGLE_LINE_IF_PATTERN = /^\s*#@\s*if\/end\b/;
const YTT_SINGLE_LINE_FOR_PATTERN = /^\s*#@\s*for\/end\b/;
const YAML_SEPARATOR_PATTERN = /^\s*---\s*$/;
const YAML_DOCUMENT_START_PATTERN = /^\s*apiVersion:\s*/;
const PLAIN_COMMENT_DIAGNOSTIC_CODE = 'prefer-ytt-comment';

function activate(context) {
    const diagnostics = vscode.languages.createDiagnosticCollection('ytt-language-support');
    const foldingRangeProvider = {
        provideFoldingRanges(document) {
            if (!isYttAwareDocument(document)) {
                return [];
            }

            return provideFoldingRanges(document);
        }
    };

    context.subscriptions.push(
        diagnostics,
        vscode.languages.registerFoldingRangeProvider(
            [{ language: 'ytt' }, { language: 'yaml' }],
            foldingRangeProvider
        ),
        vscode.languages.registerCodeActionsProvider(
            [{ language: 'ytt' }, { language: 'yaml' }],
            createCommentCodeActionProvider(),
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        ),
        vscode.commands.registerCommand('yttLanguageSupport.previewMarkers', async () => {
            await previewMarkers();
        }),
        vscode.commands.registerCommand('yttLanguageSupport.validateCurrentFile', async () => {
            await validateCurrentFile(diagnostics);
        }),
        vscode.workspace.onDidOpenTextDocument((document) => {
            void refreshDiagnostics(document, diagnostics);
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            void refreshDiagnostics(event.document, diagnostics);
        }),
        vscode.workspace.onDidSaveTextDocument((document) => {
            void refreshDiagnostics(document, diagnostics, { runValidation: shouldValidateOnSave(document) });
        }),
        vscode.workspace.onDidCloseTextDocument((document) => {
            diagnostics.delete(document.uri);
        })
    );

    for (const document of vscode.workspace.textDocuments) {
        void refreshDiagnostics(document, diagnostics);
    }
}

function deactivate() {}

function provideFoldingRanges(document) {
    const lines = getDocumentLines(document);
    const ranges = [];

    appendControlFoldingRanges(lines, ranges);
    appendYamlDocumentRanges(lines, ranges);
    appendYamlBlockRanges(lines, ranges);

    return dedupeFoldingRanges(ranges);
}

function appendControlFoldingRanges(lines, ranges) {
    const stack = [];

    for (let index = 0; index < lines.length; index++) {
        const classification = classifyLine(lines[index]);
        if (!classification || classification.type === 'comment') {
            continue;
        }

        if (classification.type === 'single-line-if' || classification.type === 'single-line-for') {
            const nextLine = findNextContentLine(lines, index + 1);
            if (nextLine !== -1) {
                const endLine = findNodeEnd(lines, nextLine);
                if (endLine > index) {
                    ranges.push(new vscode.FoldingRange(index, endLine, vscode.FoldingRangeKind.Region));
                }
            }
            continue;
        }

        if (classification.type === 'open') {
            stack.push({
                kind: classification.keyword,
                startLine: index,
                segmentStart: index
            });
            continue;
        }

        if (classification.type === 'branch') {
            const current = stack[stack.length - 1];
            if (!current || current.kind !== 'if') {
                continue;
            }

            if (index - 1 > current.segmentStart) {
                ranges.push(new vscode.FoldingRange(
                    current.segmentStart,
                    index - 1,
                    vscode.FoldingRangeKind.Region
                ));
            }

            current.segmentStart = index;
            continue;
        }

        if (classification.type === 'close') {
            const current = stack.pop();
            if (!current) {
                continue;
            }

            const segmentStart = current.kind === 'if' ? current.segmentStart : current.startLine;
            if (index > segmentStart) {
                ranges.push(new vscode.FoldingRange(
                    segmentStart,
                    index,
                    vscode.FoldingRangeKind.Region
                ));
            }
        }
    }
}

function appendYamlDocumentRanges(lines, ranges) {
    for (let index = 0; index < lines.length; index++) {
        if (!YAML_DOCUMENT_START_PATTERN.test(lines[index].trim())) {
            continue;
        }

        const endLine = findDocumentEnd(lines, index);
        if (endLine > index) {
            ranges.push(new vscode.FoldingRange(index, endLine, vscode.FoldingRangeKind.Region));
        }
    }
}

function appendYamlBlockRanges(lines, ranges) {
    for (let index = 0; index < lines.length; index++) {
        const trimmed = lines[index].trim();

        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        if (!trimmed.endsWith(':')) {
            continue;
        }

        const endLine = findIndentedBlockEnd(lines, index);
        if (endLine > index) {
            ranges.push(new vscode.FoldingRange(index, endLine, vscode.FoldingRangeKind.Region));
        }
    }
}

function findDocumentEnd(lines, startIndex) {
    const startIndent = indentationOf(lines[startIndex]);
    let endLine = startIndex;

    for (let index = startIndex + 1; index < lines.length; index++) {
        const trimmed = lines[index].trim();

        if (!trimmed) {
            continue;
        }

        if (YAML_SEPARATOR_PATTERN.test(trimmed)) {
            break;
        }

        if (YAML_DOCUMENT_START_PATTERN.test(trimmed) && indentationOf(lines[index]) <= startIndent) {
            break;
        }

        endLine = index;
    }

    return endLine;
}

function findIndentedBlockEnd(lines, startIndex) {
    const startIndent = indentationOf(lines[startIndex]);
    let endLine = startIndex;

    for (let index = startIndex + 1; index < lines.length; index++) {
        const line = lines[index];
        const trimmed = line.trim();

        if (!trimmed) {
            continue;
        }

        if (YAML_SEPARATOR_PATTERN.test(trimmed)) {
            break;
        }

        if (YTT_COMMENT_PATTERN.test(trimmed) || PLAIN_YAML_COMMENT_PATTERN.test(trimmed)) {
            endLine = index;
            continue;
        }

        if (YTT_DIRECTIVE_PATTERN.test(trimmed)) {
            if (YTT_END_PATTERN.test(trimmed) && indentationOf(line) <= startIndent) {
                break;
            }

            endLine = index;
            continue;
        }

        if (indentationOf(line) <= startIndent) {
            break;
        }

        endLine = index;
    }

    return endLine;
}

function findNextContentLine(lines, fromIndex) {
    for (let index = fromIndex; index < lines.length; index++) {
        const trimmed = lines[index].trim();
        if (!trimmed) {
            continue;
        }

        if (YTT_COMMENT_PATTERN.test(trimmed) || PLAIN_YAML_COMMENT_PATTERN.test(trimmed)) {
            continue;
        }

        return index;
    }

    return -1;
}

function findNodeEnd(lines, startIndex) {
    const firstLine = lines[startIndex];
    const firstTrimmed = firstLine.trim();
    const startIndent = indentationOf(firstLine);
    let endLine = startIndex;

    for (let index = startIndex + 1; index < lines.length; index++) {
        const line = lines[index];
        const trimmed = line.trim();

        if (!trimmed) {
            continue;
        }

        if (YAML_SEPARATOR_PATTERN.test(trimmed)) {
            break;
        }

        if (YTT_COMMENT_PATTERN.test(trimmed) || PLAIN_YAML_COMMENT_PATTERN.test(trimmed)) {
            endLine = index;
            continue;
        }

        if (YTT_DIRECTIVE_PATTERN.test(trimmed)) {
            if (YTT_END_PATTERN.test(trimmed) && indentationOf(line) <= startIndent) {
                break;
            }

            endLine = index;
            continue;
        }

        const nextIndent = indentationOf(line);

        if (firstTrimmed.startsWith('-')) {
            if (nextIndent < startIndent) {
                break;
            }

            if (nextIndent === startIndent && trimmed.startsWith('-')) {
                break;
            }

            endLine = index;
            continue;
        }

        if (firstTrimmed.endsWith(':')) {
            if (nextIndent <= startIndent) {
                break;
            }

            endLine = index;
            continue;
        }

        if (nextIndent <= startIndent) {
            break;
        }

        endLine = index;
    }

    return endLine;
}

function classifyLine(line) {
    const trimmed = line.trim();

    if (!trimmed) {
        return null;
    }

    if (YTT_COMMENT_PATTERN.test(trimmed) || PLAIN_YAML_COMMENT_PATTERN.test(trimmed)) {
        return { type: 'comment' };
    }

    if (YTT_SINGLE_LINE_IF_PATTERN.test(trimmed)) {
        return { type: 'single-line-if' };
    }

    if (YTT_SINGLE_LINE_FOR_PATTERN.test(trimmed)) {
        return { type: 'single-line-for' };
    }

    const openMatch = trimmed.match(YTT_OPEN_PATTERN);
    if (openMatch) {
        return { type: 'open', keyword: openMatch[1] };
    }

    if (YTT_BRANCH_PATTERN.test(trimmed)) {
        return { type: 'branch' };
    }

    if (YTT_END_PATTERN.test(trimmed)) {
        return { type: 'close' };
    }

    if (YAML_SEPARATOR_PATTERN.test(trimmed)) {
        return { type: 'yaml-separator' };
    }

    return null;
}

function dedupeFoldingRanges(ranges) {
    const seen = new Set();
    const deduped = [];

    for (const range of ranges) {
        const key = `${range.start}:${range.end}:${range.kind || 'region'}`;
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        deduped.push(range);
    }

    return deduped.sort((left, right) => left.start - right.start || left.end - right.end);
}

function createCommentCodeActionProvider() {
    return {
        provideCodeActions(document, _range, context) {
            if (!isYttAwareDocument(document)) {
                return [];
            }

            const actions = [];
            for (const diagnostic of context.diagnostics) {
                if (diagnostic.code !== PLAIN_COMMENT_DIAGNOSTIC_CODE) {
                    continue;
                }

                const line = diagnostic.range.start.line;
                const text = document.lineAt(line).text;
                const hashIndex = text.indexOf('#');
                if (hashIndex === -1) {
                    continue;
                }

                const action = new vscode.CodeAction(
                    'Convert comment to #!',
                    vscode.CodeActionKind.QuickFix
                );
                action.isPreferred = true;
                action.diagnostics = [diagnostic];

                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(line, hashIndex, line, hashIndex + 1),
                    '#!'
                );
                action.edit = edit;
                actions.push(action);
            }

            return actions;
        }
    };
}

async function previewMarkers() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('Open a YTT or YAML document to preview YTT markers.');
        return;
    }

    const document = editor.document;
    if (!isYttAwareDocument(document)) {
        vscode.window.showInformationMessage('No YTT markers detected in the active document.');
        return;
    }

    const markers = collectMarkers(document);
    if (!markers.length) {
        vscode.window.showInformationMessage('No YTT markers detected in the active document.');
        return;
    }

    const selected = await vscode.window.showQuickPick(
        markers.map((marker) => ({
            label: marker.label,
            description: `Line ${marker.line + 1}`,
            detail: marker.detail,
            line: marker.line
        })),
        {
            placeHolder: 'Select a YTT marker to reveal it in the editor'
        }
    );

    if (!selected) {
        return;
    }

    const position = new vscode.Position(selected.line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

async function validateCurrentFile(diagnostics) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('Open a YTT or YAML document to validate it with ytt.');
        return;
    }

    const document = editor.document;
    if (!isYttAwareDocument(document)) {
        vscode.window.showInformationMessage('The active document does not look like a YTT template.');
        return;
    }

    const documentDiagnostics = await refreshDiagnostics(document, diagnostics, { runValidation: true });
    const validationErrors = documentDiagnostics.filter(
        (diagnostic) => diagnostic.source === 'ytt'
    );

    if (!validationErrors.length) {
        vscode.window.showInformationMessage('ytt validation completed successfully.');
    }
}

async function refreshDiagnostics(document, diagnostics, options = {}) {
    if (!shouldManageDocument(document)) {
        diagnostics.delete(document.uri);
        return [];
    }

    const documentDiagnostics = [];
    const configuration = vscode.workspace.getConfiguration('yttLanguageSupport', document.uri);

    if (configuration.get('comments.warnOnPlainYamlComments', true)) {
        documentDiagnostics.push(...collectCommentDiagnostics(document));
    }

    if (options.runValidation) {
        documentDiagnostics.push(...await collectValidationDiagnostics(document, configuration));
    }

    diagnostics.set(document.uri, documentDiagnostics);
    return documentDiagnostics;
}

function collectCommentDiagnostics(document) {
    if (!isYttAwareDocument(document)) {
        return [];
    }

    const diagnostics = [];
    for (let index = 0; index < document.lineCount; index++) {
        const line = document.lineAt(index);
        if (!PLAIN_YAML_COMMENT_PATTERN.test(line.text)) {
            continue;
        }

        const hashIndex = line.text.indexOf('#');
        const range = new vscode.Range(index, hashIndex, index, line.text.length);
        const diagnostic = new vscode.Diagnostic(
            range,
            'Prefer #! for comments in ytt templates.',
            vscode.DiagnosticSeverity.Information
        );
        diagnostic.source = 'ytt-language-support';
        diagnostic.code = PLAIN_COMMENT_DIAGNOSTIC_CODE;
        diagnostics.push(diagnostic);
    }

    return diagnostics;
}

async function collectValidationDiagnostics(document, configuration) {
    if (document.isUntitled || document.uri.scheme !== 'file') {
        return [];
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
        return [];
    }

    const binaryPath = configuration.get('validation.binaryPath', 'ytt');
    const args = ['-f', document.uri.fsPath];

    try {
        await execFileAsync(binaryPath, args, { cwd: workspaceFolder.uri.fsPath });
        return [];
    } catch (error) {
        return toValidationDiagnostics(document, error);
    }
}

function toValidationDiagnostics(document, error) {
    const output = [error.stderr, error.stdout, error.message]
        .filter(Boolean)
        .join('\n')
        .trim();

    if (!output) {
        return [];
    }

    const diagnostics = [];
    const messageLines = output.split(/\r?\n/).filter(Boolean);
    const linePattern = /\bline\s+(\d+)(?:[:,]\s*column\s+(\d+))?/i;

    for (const message of messageLines) {
        const match = message.match(linePattern);
        if (!match) {
            continue;
        }

        const lineNumber = Math.max(Number.parseInt(match[1], 10) - 1, 0);
        const line = document.lineAt(Math.min(lineNumber, Math.max(document.lineCount - 1, 0)));
        const columnNumber = match[2] ? Math.max(Number.parseInt(match[2], 10) - 1, 0) : 0;
        const startCharacter = Math.min(columnNumber, line.text.length);
        const endCharacter = line.text.length === 0
            ? 0
            : Math.min(Math.max(startCharacter + 1, 1), line.text.length);
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(line.lineNumber, startCharacter, line.lineNumber, endCharacter),
            message,
            vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = 'ytt';
        diagnostics.push(diagnostic);
    }

    if (!diagnostics.length) {
        const line = document.lineCount ? document.lineAt(0) : { lineNumber: 0, text: '' };
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(line.lineNumber, 0, line.lineNumber, line.text.length),
            output,
            vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = 'ytt';
        diagnostics.push(diagnostic);
    }

    return diagnostics;
}

function collectMarkers(document) {
    const markers = [];

    for (let index = 0; index < document.lineCount; index++) {
        const text = document.lineAt(index).text;
        const trimmed = text.trim();
        if (!trimmed) {
            continue;
        }

        if (YTT_COMMENT_PATTERN.test(trimmed)) {
            markers.push({
                label: '#! comment',
                line: index,
                detail: trimmed
            });
            continue;
        }

        if (findInlineYttCommentIndex(text) !== -1) {
            markers.push({
                label: '#! comment',
                line: index,
                detail: trimmed
            });
        }

        if (YTT_ANNOTATION_PATTERN.test(trimmed)) {
            markers.push({
                label: trimmed.split(/\s+/)[0],
                line: index,
                detail: trimmed
            });
            continue;
        }

        if (YTT_DEFINITION_PATTERN.test(trimmed) || YTT_DIRECTIVE_PATTERN.test(trimmed)) {
            const match = trimmed.match(
                /^#@\s*(if\/end|for\/end|if|elif|else|for|def|end|load|return|yaml)\b/
            );
            markers.push({
                label: match ? `#@ ${match[1]}` : '#@ directive',
                line: index,
                detail: trimmed
            });
            continue;
        }

        if (trimmed.startsWith('#@')) {
            markers.push({
                label: deriveStatementMarkerLabel(trimmed),
                line: index,
                detail: trimmed
            });
            continue;
        }

        if (trimmed.includes('(@')) {
            markers.push({
                label: '(@ template @)',
                line: index,
                detail: trimmed
            });
        }
    }

    return markers;
}

function shouldManageDocument(document) {
    return document && (document.languageId === 'ytt' || document.languageId === 'yaml');
}

function shouldValidateOnSave(document) {
    const configuration = vscode.workspace.getConfiguration('yttLanguageSupport', document.uri);
    return isYttAwareDocument(document) && configuration.get('validation.mode', 'manual') === 'onSave';
}

function isYttAwareDocument(document) {
    if (!document) {
        return false;
    }

    if (document.languageId === 'ytt') {
        return true;
    }

    if (document.languageId !== 'yaml') {
        return false;
    }

    return YTT_MARKER.test(document.getText());
}

function getDocumentLines(document) {
    return document.getText().split(/\r?\n/);
}

function indentationOf(line) {
    const match = line.match(/^\s*/);
    return match ? match[0].length : 0;
}

function execFileAsync(command, args, options) {
    return new Promise((resolve, reject) => {
        execFile(command, args, options, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }

            resolve({ stdout, stderr });
        });
    });
}

function findInlineYttCommentIndex(line) {
    const match = line.match(/(^|\s)(#!)/);
    if (!match) {
        return -1;
    }

    return match.index + match[1].length;
}

function deriveStatementMarkerLabel(trimmed) {
    const assignmentMatch = trimmed.match(/^#@\s*([A-Za-z_][\w.]*)\s*=/);
    if (assignmentMatch) {
        return `#@ ${assignmentMatch[1]} =`;
    }

    const identifierMatch = trimmed.match(/^#@\s*([A-Za-z_][\w.]*)\b/);
    if (identifierMatch) {
        return `#@ ${identifierMatch[1]}`;
    }

    return '#@ statement';
}

module.exports = {
    activate,
    deactivate,
    _internal: {
        YTT_MARKER,
        classifyLine,
        collectCommentDiagnostics,
        collectMarkers,
        dedupeFoldingRanges,
        deriveStatementMarkerLabel,
        findInlineYttCommentIndex,
        findDocumentEnd,
        findIndentedBlockEnd,
        findNodeEnd,
        getDocumentLines,
        indentationOf,
        isYttAwareDocument,
        provideFoldingRanges,
        toValidationDiagnostics
    }
};
