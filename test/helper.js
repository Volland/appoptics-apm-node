'use strict'

const ao = exports.ao = require('..')
const realPort = ao.port
ao.skipSample = true

const Emitter = require('events').EventEmitter
const debug = require('debug')('appoptics:test:helper')
const extend = require('util')._extend
const bson = require('bson')
const dgram = require('dgram')
const https = require('https')
const http = require('http')
const path = require('path')

Error.stackTraceLimit = 25

const log = ao.loggers

log.addGroup({
  groupName: 'test',
  subNames: ['info', 'mock-port', 'message', 'span']
})

exports.clsCheck = function () {
  const c = ao.requestStore
  if (!c || !c.active) {
    throw new Error('CLS: NO ACTIVE ao-request-store NAMESPACE')
  }
}

exports.noop = function () {}

// each module must implement. this only provides a
// common framework to check the environment variable.
exports.skipTest = function (filename) {
  if (!process.env.AO_SKIP_TEST) {
    return false
  }

  const skips = process.env.AO_SKIP_TEST.split(',')
  const test = path.basename(filename, '.test.js')

  if (!~skips.indexOf(test)) {
    return false
  }

  ao.loggers.warn('skipping test', test)
  return true
}

const addon = ao.addon
const oboeVersion = addon ? addon.Config.getVersionString() : '<not loaded>'
log.debug('Using oboe version %s', oboeVersion)

// if not specifically turning on error and warning debugging, turn it off
if (!('AO_TEST_SHOW_LOGS' in process.env)) {
  log.debug('AO_TEST_SHOW_LOGS not set, turning off logging')
  let logs = (process.env.DEBUG || '').split(',')
  logs = logs.filter(function (item) {
    return !item.startsWith('appoptics:')
  }).join(',')
  // set to whatever it was with appoptics items removed
  process.env.DEBUG = logs
  // pseudo-log-level that has no logger.
  ao.logLevel = 'none'
}

const BSON = new bson.BSONPure.BSON()

let udpPort = 7832

if (process.env.APPOPTICS_REPORTER_UDP) {
  const parts = process.env.APPOPTICS_REPORTER_UDP.split(':')
  if (parts.length == 2) udpPort = parts[1]
}

debug('helper found real port = ' + realPort)

function udpSend (msg, port, host) {
  const client = dgram.createSocket('udp4')
  client.send(msg, 0, msg.length, Number(port), host, function () {
    client.close()
  })
}

exports.appoptics = function (done) {
  // Create UDP server to mock appoptics
  const server = dgram.createSocket('udp4')

  // Create emitter to forward messages
  const emitter = new Emitter()

  // note emitter is being handled by appoptics. some tests don't invoke
  // appoptics, only doChecks() which will need to log messages if this is
  // not active.
  emitter.__aoActive = true

  // Forward events
  server.on('error', emitter.emit.bind(emitter, 'error'))
  server.on('message', function (msg) {
    const port = server.address().port
    const parsed = BSON.deserialize(msg)
    log.test.message('mock appoptics (port ' + port + ') received', parsed)
    if (emitter.log) {
      console.log(parsed)
    }
    emitter.emit('message', parsed)

    if (emitter.forward) {
      udpSend(msg, realPort, '127.0.0.1')
    }
  })

  // Wait for the server to become available
  server.on('listening', function () {
    const port = server.address().port
    ao.port = port.toString()
    emitter.port = port
    debug('mock appoptics (port ' + port + ') listening')
    process.nextTick(done)
  })

  // Start mock tracelyzer
  server.bind(udpPort, 'localhost')

  // Expose some things through the emitter
  emitter.server = server

  // Attach close function to use in after()
  emitter.close = function (done) {
    const port = server.address().port
    server.on('close', function () {
      debug('mock appoptics (port ' + port + ') closed')
      process.nextTick(done)
    })
    server.close()
  }

  return emitter
}

exports.doChecks = function (emitter, checks, done) {
  const addr = emitter.server.address()
  emitter.removeAllListeners('message')

  debug('doChecks invoked - server address ' + addr.address + ':' + addr.port)

  function onMessage (msg) {
    if (!emitter.__aoActive) {
      log.test.message('mock (' + addr.port + ') received message', msg)
    }
    const check = checks.shift()
    if (check) {
      if (emitter.skipOnMatchFail) {
        try { check(msg) }
        catch (e) { checks.unshift(check) }
      } else {
        check(msg)
      }
    }

    // Always verify that X-Trace and Edge values are valid
    msg.should.have.property('X-Trace').and.match(/^2B[0-9A-F]{58}$/)
    if (msg.Edge) msg.Edge.should.match(/^[0-9A-F]{16}$/)

    debug(checks.length + ' checks left')
    if (!checks.length) {
      // NOTE: This is only needed because some
      // tests have less checks than messages
      emitter.removeListener('message', onMessage)
      done()
    }
  }

  emitter.on('message', onMessage)
}

const check = {
  'http-entry': function (msg) {
    msg.should.have.property('Layer', 'nodejs')
    msg.should.have.property('Label', 'entry')
    debug('entry is valid')
  },
  'http-exit': function (msg) {
    msg.should.have.property('Layer', 'nodejs')
    msg.should.have.property('Label', 'exit')
    debug('exit is valid')
  }
}

exports.test = function (emitter, test, validations, done) {
  function noop () {}
  // noops skip testing the 'outer' span.
  validations.unshift(noop)
  validations.push(noop)
  exports.doChecks(emitter, validations, done)

  ao.requestStore.run(function () {
    const span = new ao.Span('outer')
    // span.async = true
    span.enter()
    log.test.span('helper.test outer: %l', span)

    log.test.info('test started')
    test(function (err, data) {
      log.test.info('test ended: ' + (err ? 'failed' : 'passed'))
      if (err) return done(err)
      data // suppress the eslint error.
      span.exit()
    })
  })
}

exports.httpTest = function (emitter, test, validations, done) {
  const server = http.createServer(function (req, res) {
    debug('test started')
    test(function (err, data) {
      debug('test ended')
      if (err) return done(err)
      res.end(data)
    })
  })

  validations.unshift(check['http-entry'])
  validations.push(check['http-exit'])
  exports.doChecks(emitter, validations, function () {
    server.close(done)
  })

  server.listen(function () {
    const port = server.address().port
    debug('test server listening on port ' + port)
    http.get('http://localhost:' + port, function (res) {
      res.resume()
    }).on('error', done)
  })
}

exports.httpsTest = function (emitter, options, test, validations, done) {
  const server = https.createServer(options, function (req, res) {
    debug('test started')
    test(function (err, data) {
      debug('test ended')
      if (err) return done(err)
      res.end(data)
    })
  })

  validations.unshift(check['http-entry'])
  validations.push(check['http-exit'])
  exports.doChecks(emitter, validations, function () {
    server.close(done)
  })

  server.listen(function () {
    const port = server.address().port
    debug('test server listening on port ' + port)
    https.get('https://localhost:' + port, function (res) {
      res.resume()
    }).on('error', done)
  })
}

exports.run = function (context, path) {
  context.data = context.data || {}
  const mod = require('./probes/' + path)

  if (mod.data) {
    let data = mod.data
    if (typeof data === 'function') {
      data = data(context)
    }
    extend(context.data, data)
  }

  context.ao = ao

  return function (done) {
    return mod.run(context, done)
  }
}

exports.after = function (n, done) {
  return function () {
    --n || done()
  }
}

function Address (host, port) {
  this.host = host
  this.port = port
}
exports.Address = Address
Address.prototype.toString = function () {
  return this.host + ':' + this.port
}

Address.from = function (input) {
  return input.split(',').map(function (name) {
    const parts = name.split(':')
    const host = parts.shift()
    const port = parts.shift() || ''
    return new Address(host, port)
  })
}

exports.setUntil = function (obj, prop, value, done) {
  const old = obj[prop]
  obj[prop] = value
  return function () {
    obj[prop] = old
    done.apply(this, arguments)
  }
}

exports.linksTo = linksTo
function linksTo (a, b) {
  a.Edge.should.eql(b['X-Trace'].substr(42, 16))
}

exports.edgeTracker = edgeTracker
function edgeTracker (parent, fn) {
  let started = false
  function tracker (msg) {
    // Verify link to last message in parent
    if (!started) {
      if (parent) {
        linksTo(msg, parent.last)
      }
      started = true
    }

    // Verify link to last message in this branch
    if (tracker.last) {
      linksTo(msg, tracker.last)
    }

    tracker.last = msg
    if (fn) fn(msg)
  }

  return tracker
}

exports.checkEntry = checkEntry
function checkEntry (name, fn) {
  return function (msg) {
    msg.should.have.property('X-Trace')
    msg.should.have.property('Label', 'entry')
    msg.should.have.property('Layer', name)
    if (fn) fn(msg)
  }
}

exports.checkExit = checkExit
function checkExit (name, fn) {
  return function (msg) {
    msg.should.have.property('X-Trace')
    msg.should.have.property('Label', 'exit')
    msg.should.have.property('Layer', name)
    if (fn) fn(msg)
  }
}

exports.checkInfo = checkInfo
function checkInfo (data, fn) {
  const withData = checkData(data)
  return function (msg) {
    msg.should.not.have.property('Layer')
    msg.should.have.property('Label', 'info')
    withData(msg)
    if (fn) fn(msg)
  }
}

exports.checkError = checkError
function checkError (error, fn) {
  return function (msg) {
    msg.should.not.have.property('Layer')
    msg.should.have.property('Label', 'error')
    msg.should.have.property('ErrorClass', 'Error')
    msg.should.have.property('ErrorMsg', error.message)
    msg.should.have.property('Backtrace', error.stack)
    if (fn) fn(msg)
  }
}

exports.checkData = checkData
function checkData (data, fn) {
  return function (msg) {
    Object.keys(data).forEach(function (key) {
      msg.should.have.property(key, data[key])
    })
    if (fn) fn(msg)
  }
}
