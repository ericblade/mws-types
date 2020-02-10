// TODO: configure npm publishing to publish the types data, not the source code, then publish this
// as a package.
const wget = require('node-wget-promise');
const fs = require('fs').promises;
const parser = require('xml2json');
const httpserver = require('http-server');
const exec = require('node-exec-promise').exec;

// const BASE_URL = 'https://images-na.ssl-images-amazon.com/images/G/01/rainier/help/xsd/release_1_9';
const BASE_URL = 'https://images-na.ssl-images-amazon.com/images/G/01/rainier/help/xsd/release_4_1';
// TODO: Anyone know where to find any XSD for the APIs other than Products?
const PRODUCT_API_BASE = 'http://g-ecx.images-amazon.com/images/G/01/mwsportal/doc/en_US/products';
const PRODUCT_API_FILE = 'default.xsd';
const ENVELOPE_TEMP = 'amzn-envelope.original.xsd';
const ENVELOPE = 'amzn-envelope.xsd';
const DEST = './xsd'; // TODO: make sure dest exists

async function getFile(src, dest, srcDir = BASE_URL) {
    try {
        const ret = await wget(`${srcDir}/${src}`, { output: `${DEST}/${dest}`});
        return ret;
    } catch (err) {
        console.error(`* Error getting ${srcDir}/${src}: ${err}`);
    }
}

async function getFiles(arr, srcDir) {
    return Promise.all(arr.map((file) => getFile(file, file, srcDir)));
}

async function getXsdIncludes(file) {
    const xsd = await fs.readFile(`${DEST}/${file}`);
    const json = JSON.parse(parser.toJson(xsd));
    const schemaKey = json['xsd:schema'] ? 'xsd:schema'
        : json['schema'] ? 'schema'
        : null;
    if (!schemaKey) return null;
    console.warn('* json = ', json);
    if (!json[schemaKey]) return null;
    const key = json[schemaKey]['xsd:include'] !== undefined ? 'xsd:include'
        : json[schemaKey]['xs:include'] !== undefined ? 'xs:include'
        : json[schemaKey]['import'] !== undefined ? 'import'
        : null;
    if (!key) return null;
    console.warn('* includes=', json[schemaKey][key]);
    if (json[schemaKey][key].length) {
        return json[schemaKey][key].map((inc) => {
            if (inc.schemaLocation !== 'xml.xsd') return inc.schemaLocation;
            return null;
        });
    }
    return json[schemaKey][key].schemaLocation !== 'xml.xsd' ? [json[schemaKey][key].schemaLocation] : null;
}

(async () => {
    console.log('* Getting envelope');
    await getFile(ENVELOPE, ENVELOPE_TEMP);

    const env = await fs.readFile(`${DEST}/${ENVELOPE_TEMP}`);

    console.log('* Adding targetNamespace to envelope');
    const json = JSON.parse(parser.toJson(env, { reversible: true }));
    json['xsd:schema'].targetNamespace = 'urn:amazon-mws';
    const str = JSON.stringify(json);
    const xml = parser.toXml(str);
    await fs.writeFile(`${DEST}/${ENVELOPE}`);

    console.log('* Getting dependencies of envelope');
    const deps = await getXsdIncludes(ENVELOPE_TEMP);
    if (deps) {
        await getFiles(deps);
        const furtherDownloads = [];
        await new Promise((resolve) => {
            let checked = 0;
            deps.forEach(async (file) => {
                const inc = await getXsdIncludes(file);
                if (inc) {
                    furtherDownloads.push(...inc);
                }
                checked += 1;
                if (checked === deps.length) {
                    resolve();
                }
            });
        });
        if (furtherDownloads.length > 0) {
            console.log('* Getting next level of dependencies');
            // TODO: ideally, getFiles would handle recursively getting all deps, but I don't want
            // risk running into infinte loops, and I think depth of 1 recursion should be ok for
            // existing schema
            await getFiles([...new Set(furtherDownloads)]);
        }
    }

    console.log('* Getting API XSDs');
    await wget(`${PRODUCT_API_BASE}/${PRODUCT_API_FILE}`, { output: `${DEST}/${PRODUCT_API_FILE}` });
    const apiDeps = await getXsdIncludes(PRODUCT_API_FILE);
    console.warn('* apiDeps=', apiDeps);
    if (apiDeps) {
        await getFiles(apiDeps.filter((x => !!x && x !== 'xml.xsd')), PRODUCT_API_BASE);
        // TODO: i don't believe there's a second level possible here, but maybe?
    }
    // TODO: Need to re-write the default.xsd to remove <import namespace="http://www.w3.org/XML/1998/namespace" schemaLocation="xml.xsd" />

    console.log('* Starting http server');
    const server = httpserver.createServer({ root: DEST });
    server.listen(8080);

    console.log('* Running cxsd on data schema...');
    try {
        const x = await exec(`npm run cxsd http://localhost:8080/${ENVELOPE}`);
        console.log('* cxsd output', x.stdout);
        console.log('* cxsd errors', x.stderr);
    } catch (err) {
        console.error('* cxsd error', err);
        //
    }

    console.log('* Running cxsd on API schema...');
    try {
        const x = await exec(`npm run cxsd http://localhost:8080/${PRODUCT_API_FILE}`);
        console.log('* cxsd output', x.stdout);
        console.log('* cxsd errors', x.stderr);
    } catch (err) {
        console.error('* cxsd error', err);
        //
    }
    // TODO: we might want to go through the output files from cxsd and automatically s/localhost:8080/${BASE_URL}/
})();
