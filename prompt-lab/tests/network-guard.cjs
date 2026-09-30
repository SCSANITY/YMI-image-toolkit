'use strict'

const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const tls = require('node:tls')

function blocked() {
  throw new Error('prompt_lab_tests_forbid_network_egress')
}

globalThis.fetch = blocked
for (const module of [http, https]) {
  module.request = blocked
  module.get = blocked
}
net.connect = blocked
net.createConnection = blocked
tls.connect = blocked
globalThis.__YMI_PROMPT_LAB_NETWORK_GUARD__ = true
