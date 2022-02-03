#!/usr/bin/env zx

import * as fs from 'fs'
import * as path from 'path'
import * as babelParser from '@babel/parser'

const {default:babelTraverse} = require('@babel/traverse')

const files = await globby(['./pages/api/**/*.ts'])
const methodToRoute = {}

await Promise.all(files.map(async file => {
    const content = await fs.promises.readFile(file, 'utf8')
    const ast = babelParser.parse(content, {
        sourceType: 'module',
        sourceFilename: path.basename(file),
        plugins: ['typescript']
    })
    const route = file.substring('./pages'.length).split('.')[0]

    babelTraverse(ast, {
        ExportNamedDeclaration({ node }) {
            console.warn(`Found: ${node.declaration.id.name} in ${route}`)
            methodToRoute[node.declaration.id.name] = route
        },
    });
}))

await fs.promises.writeFile('./hooks/bridge-method-map.tsx', `
/* eslint-disable */
// Auto-generated
export const MethodToRoute: Record<string, string> = ${JSON.stringify(methodToRoute, null, '\t')}
`)
