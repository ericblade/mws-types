// TODO: configure npm publishing to publish the types data, not the source code, then publish this
// as a package.
const wget = require('node-wget-promise');
const fs = require('fs').promises;
const parser = require('xml2json');
const httpserver = require('http-server');
const exec = require('node-exec-promise').exec;

const BASE_URL = 'https://images-na.ssl-images-amazon.com/images/G/01/rainier/help/xsd/release_1_9';
// const BASE_URL = 'https://images-na.ssl-images-amazon.com/images/G/01/rainier/help/xsd/release_4_1';
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
    // console.warn('* json = ', json);
    if (!schemaKey) return null;
    if (!json[schemaKey]) return null;
    const key = json[schemaKey]['xsd:include'] !== undefined ? 'xsd:include'
        : json[schemaKey]['xs:include'] !== undefined ? 'xs:include'
        : json[schemaKey]['import'] !== undefined ? 'import'
        : null;
    if (!key) return null;
    // console.warn('* includes=', json[schemaKey][key]);
    if (json[schemaKey][key].length) {
        return json[schemaKey][key].map((inc) => {
            if (inc.schemaLocation !== 'xml.xsd') return inc.schemaLocation;
            return null;
        });
    }
    return json[schemaKey][key].schemaLocation !== 'xml.xsd' ? [json[schemaKey][key].schemaLocation] : null;
}

async function getJsonFromXml(file) {
    const xml = await fs.readFile(`${DEST}/${file}`);
    const json = JSON.parse(parser.toJson(xml, { reversible: true }));
    return json;
}

async function putJsonToXml(json, file) {
    // console.warn('* putJsonToXml', json, file);
    const str = JSON.stringify(json);
    const xml = parser.toXml(str);
    await fs.writeFile(`${DEST}/${file}`, xml);
    // console.warn('* put complete');
    return;
}

(async () => {
    console.log('* Getting envelope');
    await getFile(ENVELOPE, ENVELOPE_TEMP);

    console.log('* Adding targetNamespace to envelope');
    const envelopeJson = await getJsonFromXml(ENVELOPE_TEMP);
    envelopeJson['xsd:schema'].targetNamespace = 'urn:amazon-mws';
    await putJsonToXml(envelopeJson, ENVELOPE);

    console.log('* Getting dependencies of envelope');
    const deps = await getXsdIncludes(ENVELOPE_TEMP);
    if (deps) {
        await getFiles(deps);
        const furtherDownloads = [];
        await new Promise((resolve) => {
            let checked = 0;
            deps.forEach(async (file) => {
                const inc = await getXsdIncludes(file);
                // console.warn(`* file ${file} includes ${inc}`);
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
            console.log('* Getting next level of dependencies', furtherDownloads);
            // TODO: ideally, getFiles would handle recursively getting all deps, but I don't want
            // risk running into infinte loops, and I think depth of 1 recursion should be ok for
            // existing schema
            await getFiles([...new Set(furtherDownloads)]);
        }
    }

    console.log('* Getting xml.xsd');
    await wget('http://www.w3.org/XML/1998/namespace/xml.xsd', { output: `${DEST}/xml.xsd`});
    console.log('* Getting API XSDs');
    await wget(`${PRODUCT_API_BASE}/${PRODUCT_API_FILE}`, { output: `${DEST}/${PRODUCT_API_FILE}` });
    const depsJson = await getJsonFromXml(PRODUCT_API_FILE);
    // ItemAttributesType provides a "xml:lang" thing, which blows up cxsd .. so delete it here.
    const indexToDeleteFrom = depsJson.schema.complexType.findIndex(x => x.name === 'ItemAttributesType');
    if (indexToDeleteFrom > -1) {
        delete depsJson.schema.complexType[indexToDeleteFrom].complexContent.extension.attribute;
        putJsonToXml(depsJson, PRODUCT_API_FILE);
    }
    // debugger;
    // if (depsJson.schema && depsJson.schema.import) {
    //     console.warn('* import before=', depsJson.schema.import);
    //     depsJson.schema.import = depsJson.schema.import.filter((imp) => imp.schemaLocation !== 'xml.xsd');
    //     console.warn('* import after=', depsJson.schema.import);
    //     putJsonToXml(depsJson, PRODUCT_API_FILE);
    // }
    // const apiDeps = await getXsdIncludes(PRODUCT_API_FILE);
    const apiDeps = depsJson.schema.import && depsJson.schema.import.map((imp) => imp.schemaLocation);
    // console.warn('* apiDeps=', apiDeps);
    if (apiDeps) {
        await getFiles(apiDeps.filter((x => !!x && x !== 'xml.xsd')), PRODUCT_API_BASE);
        // TODO: i don't believe there's a second level possible here, but maybe?
    }

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

    server.close();
    console.log('* Completed. If there are no errors, output is in xmlns directory.');
    // TODO: we might want to go through the output files from cxsd and automatically s/localhost:8080/${BASE_URL}/
})();
