const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const extension = require('../../extension');
const manifest = require('../../package.json');
const languageConfiguration = require('../../language-configuration.json');
const snippets = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', '..', 'snippets', 'ytt.code-snippets'), 'utf8')
);

function fixturePath(name) {
    return path.resolve(__dirname, '..', 'fixtures', name);
}

async function openFixture(name) {
    const document = await vscode.workspace.openTextDocument(fixturePath(name));
    await vscode.window.showTextDocument(document);
    return document;
}

async function waitForLanguage(document, languageId) {
    if (document.languageId === languageId) {
        return document;
    }

    return new Promise((resolve, reject) => {
        const subscription = vscode.workspace.onDidOpenTextDocument((openedDocument) => {
            if (openedDocument.uri.toString() !== document.uri.toString()
                || openedDocument.languageId !== languageId) {
                return;
            }

            clearTimeout(timeout);
            subscription.dispose();
            resolve(openedDocument);
        });
        const timeout = setTimeout(() => {
            subscription.dispose();
            reject(new Error(`Expected ${document.uri} to use ${languageId} language mode.`));
        }, 1500);
    });
}

suite('Carvel YTT Language Support', () => {
    suiteSetup(async () => {
        await vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`).activate();
    });

    test('uses #! as the line comment token for ytt files', () => {
        assert.strictEqual(languageConfiguration.comments.lineComment, '#!');
    });

    test('switches yaml files with ytt directive lines to ytt without claiming all yaml files', async () => {
        const plainYaml = await openFixture('plain.yaml');
        const mixedYaml = await waitForLanguage(await openFixture('mixed.yaml'), 'ytt');

        assert.strictEqual(plainYaml.languageId, 'yaml');
        assert.strictEqual(mixedYaml.languageId, 'ytt');
        assert.strictEqual(extension._internal.isYttAwareDocument(plainYaml), false);
        assert.strictEqual(extension._internal.isYttAwareDocument(mixedYaml), true);
    });

    test('detects indented ytt annotations after the first line in yml files', async () => {
        const document = await waitForLanguage(await openFixture('indented.yml'), 'ytt');

        assert.strictEqual(document.languageId, 'ytt');
    });

    test('switches to ytt when a directive is added while editing yaml', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'yaml',
            content: 'kind: ConfigMap\nmetadata:\n  name: example\n'
        });
        const editor = await vscode.window.showTextDocument(document);
        assert.strictEqual(document.languageId, 'yaml');

        await editor.edit((edit) => {
            edit.insert(new vscode.Position(2, 0), '  #@overlay/match missing_ok=True\n');
        });

        const detectedDocument = await waitForLanguage(document, 'ytt');
        assert.strictEqual(detectedDocument.languageId, 'ytt');
        assert.strictEqual(
            detectedDocument.getText(),
            'kind: ConfigMap\nmetadata:\n  #@overlay/match missing_ok=True\n  name: example\n'
        );
    });

    test('keeps yaml mode when markers do not start a line', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'yaml',
            content: '#! comment\n# Mention #@ in a comment\nname: #@ data.values.name\ntext: "(@= value @)"\n'
        });
        await vscode.window.showTextDocument(document);

        assert.strictEqual(document.languageId, 'yaml');
    });

    test('does not switch non-yaml documents containing directive lines', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'plaintext',
            content: '#@ load("@ytt:data", "data")\n'
        });
        await vscode.window.showTextDocument(document);

        assert.strictEqual(document.languageId, 'plaintext');
    });

    test('keeps .ytt.yaml files in the ytt language mode', async () => {
        const document = await openFixture('comments.ytt.yaml');
        assert.strictEqual(document.languageId, 'ytt');
    });

    test('classifies #! as a comment and if/end blocks as foldable control flow', () => {
        assert.deepStrictEqual(extension._internal.classifyLine('#! comment'), { type: 'comment' });
        assert.deepStrictEqual(extension._internal.classifyLine('#@ if/end data.values.enabled:'), { type: 'single-line-if' });
        assert.deepStrictEqual(extension._internal.classifyLine('#@ else:'), { type: 'branch' });
    });

    test('warns on plain yaml comments inside ytt-aware documents', async () => {
        const document = await openFixture('comments.ytt.yaml');
        const diagnostics = extension._internal.collectCommentDiagnostics(document);

        assert.ok(diagnostics.some((diagnostic) => diagnostic.code === 'prefer-ytt-comment'));
        assert.ok(diagnostics.every((diagnostic) => diagnostic.message.includes('Prefer #!')));
    });

    test('collects markers for directives, annotations, comments, and templates', async () => {
        const document = await openFixture('mixed.yaml');
        const markers = extension._internal.collectMarkers(document);
        const labels = markers.map((marker) => marker.label);

        assert.ok(labels.includes('#! comment'));
        assert.ok(labels.includes('#@ load'));
        assert.ok(labels.some((label) => label.startsWith('#@overlay/')));
        assert.ok(labels.includes('(@ template @)'));
    });

    test('collects generic #@ statements and inline #! comments from complex fixtures', async () => {
        const firstComplex = await openFixture('test.yaml');
        const secondComplex = await openFixture('another-complex-test.yaml');

        const firstLabels = extension._internal.collectMarkers(firstComplex).map((marker) => marker.label);
        const secondLabels = extension._internal.collectMarkers(secondComplex).map((marker) => marker.label);

        assert.strictEqual(extension._internal.isYttAwareDocument(firstComplex), true);
        assert.strictEqual(extension._internal.isYttAwareDocument(secondComplex), true);

        assert.ok(firstLabels.includes('#@ namespace ='));
        assert.ok(firstLabels.includes('#@ services ='));
        assert.ok(firstLabels.includes('#! comment'));

        assert.ok(secondLabels.includes('#@ cc_current ='));
        assert.ok(secondLabels.includes('#@ FEATURE_VERSIONS ='));
        assert.ok(secondLabels.includes('#@ _addons ='));
        assert.ok(secondLabels.includes('#! comment'));
    });

    test('provides folding ranges for nested ytt control flow', async () => {
        const document = await openFixture('comments.ytt.yaml');
        const ranges = await vscode.commands.executeCommand(
            'vscode.executeFoldingRangeProvider',
            document.uri
        );

        assert.ok(Array.isArray(ranges));
        assert.ok(ranges.some((range) => range.start === 2 && range.end >= 6));
        assert.ok(ranges.some((range) => range.start === 11 && range.end >= 13));
        assert.ok(ranges.some((range) => range.start === 16 && range.end >= 18));
    });

    test('provides stable folding ranges for complex ytt fixtures', async () => {
        const firstComplex = await openFixture('test.yaml');
        const secondComplex = await openFixture('another-complex-test.yaml');

        const firstRanges = extension._internal.provideFoldingRanges(firstComplex);
        const secondRanges = extension._internal.provideFoldingRanges(secondComplex);

        assert.ok(firstRanges.some((range) => range.start === 27 && range.end >= 34));
        assert.ok(firstRanges.some((range) => range.start === 557 && range.end >= 573));

        assert.ok(secondRanges.some((range) => range.start === 3 && range.end >= 11));
        assert.ok(secondRanges.some((range) => range.start === 530 && range.end >= 549));
    });

    test('does not provide ytt folding ranges for plain yaml files', async () => {
        const document = await openFixture('plain.yaml');
        const ranges = await vscode.commands.executeCommand(
            'vscode.executeFoldingRangeProvider',
            document.uri
        );

        assert.ok(Array.isArray(ranges));
        assert.strictEqual(ranges.length, 0);
    });

    test('offers a quick fix to convert plain comments into #! comments', async () => {
        const document = await openFixture('comments.ytt.yaml');
        const diagnostics = extension._internal.collectCommentDiagnostics(document);
        const target = diagnostics.find((diagnostic) => diagnostic.code === 'prefer-ytt-comment');

        assert.ok(target);

        const actions = await vscode.commands.executeCommand(
            'vscode.executeCodeActionProvider',
            document.uri,
            target.range
        );

        assert.ok(actions.some((action) => action.title === 'Convert comment to #!'));
    });

    test('ships comment and templating snippets', () => {
        assert.ok(snippets['YTT comment']);
        assert.ok(snippets['YTT data values']);
        assert.ok(snippets['YTT overlay match']);
    });

    test('derives marker labels for generic ytt statements', () => {
        assert.strictEqual(
            extension._internal.deriveStatementMarkerLabel('#@ FEATURE_VERSIONS = {'),
            '#@ FEATURE_VERSIONS ='
        );
        assert.strictEqual(
            extension._internal.deriveStatementMarkerLabel('#@ ntp = data.values.settings.ntp'),
            '#@ ntp ='
        );
        assert.strictEqual(
            extension._internal.deriveStatementMarkerLabel('#@ [1, 2, 3]'),
            '#@ statement'
        );
    });
});
