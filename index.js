// TODO: configure npm publishing to publish the types data, not the source code, then publish this
// as a package.
const wget = require('node-wget-promise');
const fs = require('fs').promises;
const parser = require('xml2json');
const httpserver = require('http-server');
const exec = require('node-exec-promise').exec;

const BASE_URL = 'https://images-na.ssl-images-amazon.com/images/G/01/rainier/help/xsd/release_4_1';
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
    const server = httpserver.createServer({ root: DEST });
    server.listen(8080);
    console.log('* Running cxsd...');
    const x = await exec(`npm run cxsd http://localhost:8080/${ENVELOPE}`);
    console.log('* cxsd output', x.stdout);
    // TODO: for some reason i am not at all familiar with at the moment, the process does not exit
    // on it's own after completing the exec, so we have to exit it ourselves.
    process.exit(0);
    // TODO: we might want to go through the output files from cxsd and automatically s/localhost:8080/${BASE_URL}/
})();
