const Mocha = require('mocha');
const path = require('path');

async function run() {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });

    mocha.addFile(path.resolve(__dirname, 'extension.test.js'));

    await new Promise((resolve, reject) => {
        mocha.run((failures) => {
            if (failures > 0) {
                reject(new Error(`${failures} test(s) failed.`));
                return;
            }

            resolve();
        });
    });
}

module.exports = {
    run
};
