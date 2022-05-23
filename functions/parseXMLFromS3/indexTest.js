
const fs = require('fs')
const parse = require('./parser.js').parse;
const express = require('express')
const app = express();

const file = fs.readFileSync('nsby&around2-v6-withjustus-v7.xml', {encoding: 'utf-8'})

//   const s3Params = {
//     Bucket: 'https://d3osc6gewnvltc.cloudfront.net/init/dcbc5f40-4007-4a3c-a95e-67d41998e889/https%3A%2F%2Fpreview.threekit.com%2Fapi',
//     Key: ''
// };
const sourceKey = ''
const apiUrl =''
const orgId = '23de016e-e813-4e8c-a417-583fb95e63c9'

// Importer Token from Threekit?
const apiToken = '8c4d61de-59fc-478f-8caf-3c6a2d9673f7'


parse(file, sourceKey, apiUrl, orgId, apiToken);