const vscode = require('vscode');

function activate(context) {
    // Register a folding range provider for YTT files
    const foldingRangeProvider = {
        provideFoldingRanges(document, context, token) {
            const foldingRanges = [];
            const text = document.getText();
            const lines = text.split('\n');

            function findMatchingEnd(startIndex, startIndent) {
                let nestedCount = 0;
                for (let j = startIndex + 1; j < lines.length; j++) {
                    const nextLine = lines[j].trim();
                    // Count nested starts (excluding for/end)
                    if (nextLine.match(/^#@\s*(if|for|def)\b/) && !nextLine.match(/^#@\s*for\/end\b/)) {
                        nestedCount++;
                    }
                    // Found an end
                    else if (nextLine.match(/^#@\s*end\b/)) {
                        if (nestedCount === 0) {
                            return j;
                        }
                        nestedCount--;
                    }
                }
                return null;
            }

            function findDocumentEnd(startIndex) {
                const startIndent = lines[startIndex].match(/^\s*/)[0].length;
                let lastContentLine = startIndex;

                for (let j = startIndex + 1; j < lines.length; j++) {
                    const line = lines[j];
                    if (line.trim() === '') continue;

                    // Check for document separator
                    if (line.trim() === '---') {
                        return j - 1;
                    }

                    // Check for next resource at same level
                    if (line.trim().startsWith('apiVersion:') && line.match(/^\s*/)[0].length === startIndent) {
                        return j - 1;
                    }

                    lastContentLine = j;
                }

                return lastContentLine;
            }

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                const indent = lines[i].match(/^\s*/)[0].length;
                
                // Handle YAML resource documents
                if (line.startsWith('apiVersion:')) {
                    const endLine = findDocumentEnd(i);
                    if (endLine > i) {
                        foldingRanges.push(new vscode.FoldingRange(
                            i,
                            endLine,
                            vscode.FoldingRangeKind.Region
                        ));
                    }
                }
                // Handle if/for/def blocks and elif conditions
                else if (line.match(/^#@\s*(if|for|def|elif)\b/) && !line.match(/^#@\s*for\/end\b/)) {
                    // For elif, we want to fold until the next elif/else/end
                    if (line.match(/^#@\s*elif\b/)) {
                        let endLine = i;
                        for (let j = i + 1; j < lines.length; j++) {
                            const nextLine = lines[j].trim();
                            if (nextLine.match(/^#@\s*(elif|else|end)\b/)) {
                                endLine = j - 1;
                                break;
                            }
                            if (j === lines.length - 1) {
                                endLine = j;
                            }
                        }
                        if (endLine > i) {
                            foldingRanges.push(new vscode.FoldingRange(
                                i,
                                endLine,
                                vscode.FoldingRangeKind.Region
                            ));
                        }
                    } else {
                        const endLine = findMatchingEnd(i, indent);
                        if (endLine !== null) {
                            foldingRanges.push(new vscode.FoldingRange(
                                i,
                                endLine,
                                vscode.FoldingRangeKind.Region
                            ));
                        }
                    }
                }
                // Handle for/end with list item
                else if (line.match(/^#@\s*for\/end\b/)) {
                    let endLine = i;
                    // Look ahead for the list item
                    for (let j = i + 1; j < lines.length; j++) {
                        const nextLine = lines[j].trim();
                        if (nextLine.startsWith('-')) {
                            endLine = j;
                            break;
                        }
                    }
                    foldingRanges.push(new vscode.FoldingRange(
                        i,
                        endLine,
                        vscode.FoldingRangeKind.Region
                    ));
                }
                // Handle YAML block folding
                else if (!line.startsWith('#') && line.endsWith(':')) {
                    let endLine = i;
                    // Look ahead for the end of the block
                    for (let j = i + 1; j < lines.length; j++) {
                        const nextLine = lines[j];
                        if (nextLine.trim() === '') continue;
                        
                        const nextIndent = nextLine.match(/^\s*/)[0].length;
                        const nextTrimmed = nextLine.trim();
                        
                        // Don't break on YTT directives or if we're still indented
                        if (!nextTrimmed.startsWith('#@') && nextIndent <= indent) {
                            // If this is an end statement for an outer block, don't include it
                            if (nextTrimmed.match(/^#@\s*end\b/)) {
                                endLine = j;
                            } else {
                                endLine = j - 1;
                            }
                            break;
                        }
                        if (j === lines.length - 1) {
                            endLine = j;
                        }
                    }
                    
                    if (endLine > i) {
                        foldingRanges.push(new vscode.FoldingRange(
                            i,
                            endLine,
                            vscode.FoldingRangeKind.Region
                        ));
                    }
                }
            }

            return foldingRanges;
        }
    };

    // Register the provider for both YTT and YAML files
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            [{ language: 'ytt' }, { language: 'yaml' }],
            foldingRangeProvider
        )
    );
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
