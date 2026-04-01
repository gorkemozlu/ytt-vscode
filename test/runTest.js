const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');

    await runTests({
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs: [path.resolve(__dirname, 'fixtures')]
    });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
