//Dependencies
const axios = require('axios');
const fs = require('fs-extra');
require('colors');

//General config
const url = 'https://example.host.com.br/api/bffmsexample/swagger';

//Generic badges config
const maintainer = 'exampleMaintainer';
const testCoverage = '100';
const nodeJsVersion = '14.0.0';

const colorByMethod = (method) => {
    switch (method) {
        case 'get': return 'blue';
        case 'post': return 'green';
        case 'put': return 'orange';
        case 'delete': return 'red';
        case 'patch': return '';
        default: return 'blue';
    }
};

const getFilePath = ({ path, method }) => {
    const [, version, first, , end] = path.match(/^\/(v\d+)\/(\w+)(\/?)([\w/-{}]*)/i);
    let filePath = `./docs/${version}/${first}/${method}-${first}`;
    if (end) {
        filePath = `${filePath}-${end.replace('/', '-').replace(/[{}]/gm, '')}`;
    }
    return filePath;
};

const getResponseExample = (response, definitions) => {
    let {
        description,
        schema: {
            $ref: ref,
            items: { $ref: arrayRef } = {},
        } = {},
    } = response;
    let example;
    if (response.example) {
        example = response.example.value
    }

    if (ref) {
        ref = ref.replace('#/definitions/', '');
        const { description: modelDescription, example: modelExample } = definitions[ref] || {};
        if (!example && modelExample) {
            example = modelExample;
        }

        if (!description && modelDescription) {
            description = modelDescription;
        }
    }

    if (!example && arrayRef) {
        arrayRef = arrayRef.replace('#/definitions/', '');

        const model = definitions[arrayRef];
        if (model) {
            example = [Object.entries(model.properties)
                .reduce((acc, [key, schema]) => {
                    acc[key] = schema.example || schema.type;
                    return acc;
                }, {}),
            ];
        }
    }
    return { description, example };
};

const routesBuilderTemplate = (routes) => {
    const versions = [...new Set(routes.map(({ tags }) => tags[0]))];
    const lines = versions.reduce((acc, version) => {
        const filteredRoutesPerVersion = routes.filter((route) => version === route.tags[0]);
        const routesPerVersion = filteredRoutesPerVersion.reduce((acc, args) => {
            const filePath = getFilePath(args);
            return `${acc}  * [${filePath.replace('./docs/', '')}](${filePath})\n`;
        }, '');
        return `${acc}* ${version}\n${routesPerVersion}`;
    }, '');
    return lines;
};

const readmeBuilderTemplate = ({ title = '', description = '', routes }) => `
# ${title}
![Generic badge](https://img.shields.io/badge/maintainer-${maintainer}-purple.svg)
![Generic badge](https://img.shields.io/badge/coverage-${testCoverage}-green.svg)
![Generic badge](https://img.shields.io/badge/NodeJS-${nodeJsVersion}-blue.svg)

## Description
${description}

## Big Picture
[Put big picture image here]

## Routes
${routesBuilderTemplate(routes)}

## Variables Local
\`\`\`
SERVICE_NAME=${title}
NODE_ENV=dev
LOG_PATH=./
PORT=3001
HTTPS_PORT=3002
SWAGGER=true
\`\`\`

## Run tests
\`\`\`
npm run test
\`\`\`

## Run Application
\`\`\`
npm run dev
\`\`\`
`;

const requestBuilderTemplate = (parameters) => {
    const lines = parameters.reduce((acc, {
        name, in: scope, type, required
    }) => `${acc}| ${name} | ${scope} | ${type} | ${required ? 'yes' : 'no'} |\n`, '');
    return `
| field | scope | type | required |
|--------|--------|--------|--------|
${lines}`;
};

const responseBuilderTemplate = (responses, definitions) => Object.entries(responses)
    .filter(([statusCode]) => statusCode !== 'default')
    .map(([statusCode, res]) => {
        const { description = '', example = {} } = getResponseExample(res, definitions);
        return `> ${statusCode} ${description} \n\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\``;
    }).join('\n');

const detailsBuilderTemplate = ({ path, description = '', method, responses, definitions, parameters }) => `
### Route ${path}
![Generic badge](https://img.shields.io/badge/method-${method.toUpperCase()}-${colorByMethod(method)}.svg)

---

#### Description
${description}

#### Sequence Diagram
[Put sequence diagram here!]

---
#### **REQUEST**:
${requestBuilderTemplate(parameters)}

---
#### **RESPONSE**:
${responseBuilderTemplate(responses, definitions)}

---
[![Generic badge](https://img.shields.io/badge/BACK-blue.svg)](../../README.md)
`;

const parseSwaggerData = ({ paths, definitions }) => Object.entries(paths).reduce((acc, [route, methods]) => {
    Object.entries(methods).forEach(([method, values]) => {
        const { parameters = [], ...rest } = values;
        const parsedParameters = parameters.reduce((accParams, param) => {
            if (!param.schema) {
                accParams.push(param);
            } else {
                const model = definitions[param.name];
                Object.entries(model.properties).forEach(([property, value]) => {
                    accParams.push({
                        name: property, type: value.type, in: param.in, required: model.required.includes(property),
                    });
                });
            }
            return accParams;
        }, []);
        acc.push({
            path: route,
            method,
            definitions,
            parameters: parsedParameters,
            ...rest
        });
    });
    return acc;
}, []);

(async () => {
    const { data: { paths, definitions, info: { title, description } } } = await axios.get(url);
    const parsedSwagger = parseSwaggerData({ paths, definitions });
    const readmeTemplate = readmeBuilderTemplate({ title, description, routes: parsedSwagger });
    console.log(`Generating file README.md`.yellow);
    await fs.outputFile(`README.md`, readmeTemplate);
    await Promise.all(parsedSwagger.map((args) => {
        const filePath = getFilePath(args);
        const detailsTemplate = detailsBuilderTemplate({ ...args });
        console.log(`Generating file ${filePath}.md`.yellow);
        return fs.outputFile(`${filePath}`, detailsTemplate);
    }));
})()
