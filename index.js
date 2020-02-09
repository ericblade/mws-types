// TODO: configure npm publishing to publish the types data, not the source code, then publish this
// as a package.
const wget = require('node-wget-promise');
const fs = require('fs').promises;
const parser = require('xml2json');
const httpserver = require('http-server');
const exec = require('node-exec-promise').exec;

const BASE_URL = 'https://images-na.ssl-images-amazon.com/images/G/01/rainier/help/xsd/release_4_1';
// const BASE_URL = 'https://images-na.ssl-images-amazon.com/images/G/01/rainier/help/xsd/release_1_9';
const ENVELOPE_TEMP = 'amzn-envelope.original.xsd';
const ENVELOPE = 'amzn-envelope.xsd';
const DEST = './xsd'; // TODO: make sure dest exists

(async () => {
    console.log('* Getting envelope');
    await wget(`${BASE_URL}/${ENVELOPE}`, { output: `${DEST}/${ENVELOPE_TEMP}`});
    const env = await fs.readFile(`${DEST}/${ENVELOPE_TEMP}`);
    const json = JSON.parse(parser.toJson(env, { reversible: true }));
    json['xsd:schema'].targetNamespace = 'urn:amazon-mws';

    const str = JSON.stringify(json);
    const xml = parser.toXml(str);
    await fs.writeFile(`${DEST}/${ENVELOPE}`, xml);
    console.log('* Getting additional files...');
    const promises = json['xsd:schema']['xsd:include'].map((inc) => wget(`${BASE_URL}/${inc.schemaLocation}`, { output: `${DEST}/${inc.schemaLocation}` }));
    await Promise.all(promises);
    // TODO: note that we also need to load each individual file downloaded, and check it for 'xs:include' schemaLocation
    // So, we should make a separate function that downloads a file, and then recursively downloads anything referenced
    // in xsd:include or xs:include
    const server = httpserver.createServer({ root: DEST });
    server.listen(8080);
    console.log('* Running cxsd...');
    try {
        const x = await exec(`npm run cxsd http://localhost:8080/${ENVELOPE}`);
        console.log('* cxsd output', x.stdout);
        console.log('* cxsd errors', x.stderr);
    } catch (err) {
        console.error('* cxsd error', err);
        //
    } finally {
        server.close();
    }
    // TODO: we might want to go through the output files from cxsd and automatically s/localhost:8080/${BASE_URL}/
})();
