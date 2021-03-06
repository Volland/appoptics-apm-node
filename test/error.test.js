'use strict'
var helper = require('./helper')
var ao = require('..')
var Span = ao.Span
var Event = ao.Event

describe('error', function () {
  var conf = { enabled: true }
  var error = new Error('nope')
  var emitter
  var realSampleTrace

  function testSpan (span) {
    return span.descend('test')
  }

  function handleErrorTest (task, done) {
    helper.test(emitter, task, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
        msg.should.have.property('ErrorClass', 'Error')
        msg.should.have.property('ErrorMsg', error.message)
        msg.should.have.property('Backtrace', error.stack)
      }
    ], done)
  }

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    emitter = helper.appoptics(done)
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.sampleMode = 'always'
    realSampleTrace = ao.addon.Context.sampleTrace
    ao.addon.Context.sampleTrace = function () {
      return { sample: true, source: 6, rate: ao.sampleRate }
    }
  })
  after(function (done) {
    ao.addon.Context.sampleTrace = realSampleTrace
    emitter.close(done)
  })

  //
  // Prophylactic test exists only to fix a problem with oboe not reporting a UDP
  // send failure.
  //
  it('might lose a message (until the UDP problem is fixed)', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument('fake', function () { })
      done()
    }, [
        function (msg) {
          msg.should.have.property('Label').oneOf('entry', 'exit'),
            msg.should.have.property('Layer', 'fake')
        }
      ], done)
  })

  //
  // Tests
  //
  it('should add error properties to event', function () {
    var event = new Event('error-test', 'info')
    var err = new Error('test')
    event.error = err

    event.should.have.property('ErrorClass', 'Error')
    event.should.have.property('ErrorMsg', err.message)
    event.should.have.property('Backtrace', err.stack)
  })

  it('should set error multiple times (keeping last)', function () {
    var event = new Event('error-test', 'info')
    var first = new Error('first')
    var second = new Error('second')
    event.error = first
    event.error = second

    event.should.have.property('ErrorClass', 'Error')
    event.should.have.property('ErrorMsg', second.message)
    event.should.have.property('Backtrace', second.stack)
  })

  it('should report errors in sync calls', function (done) {
    handleErrorTest(function (done) {
      try {
        ao.instrument(testSpan, function () {
          throw error
        }, conf)
      } catch (e) {}
      done()
    }, done)
  })

  it('should report errors in error-first callbacks', function (done) {
    handleErrorTest(function (done) {
      ao.instrument(testSpan, function (callback) {
        callback(error)
      }, conf, function () {
        done()
      })
    }, done)
  })

  it('should report custom errors', function (done) {
    var error = new Error('test')
    helper.test(emitter, function (done) {
      ao.reportError(error)
      done()
    }, [
      function (msg) {
        msg.should.not.have.property('Layer')
        msg.should.have.property('Label', 'error')
        msg.should.have.property('ErrorClass', 'Error')
        msg.should.have.property('ErrorMsg', error.message)
        msg.should.have.property('Backtrace', error.stack)
      }
    ], done)
  })

  it('should report custom errors within a span', function (done) {
    var error = new Error('test')
    var last

    helper.test(emitter, function (done) {
      ao.instrument(testSpan, function (callback) {
        ao.reportError(error)
        callback()
      }, conf, done)
    }, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
        last = msg['X-Trace'].substr(42, 16)
      },
      function (msg) {
        msg.should.not.have.property('Layer')
        msg.should.have.property('Label', 'error')
        msg.should.have.property('ErrorClass', 'Error')
        msg.should.have.property('ErrorMsg', error.message)
        msg.should.have.property('Backtrace', error.stack)
        msg.Edge.should.equal(last)
        last = msg['X-Trace'].substr(42, 16)
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
        msg.Edge.should.equal(last)
      }
    ], done)
  })

  it('should rethrow errors in sync calls', function (done) {
    handleErrorTest(function (done) {
      var rethrow = false
      try {
        ao.instrument(testSpan, function () {
          throw error
        }, conf)
      } catch (e) {
        rethrow = e === error
      }
      if ( ! rethrow) {
        throw new Error('did not rethrow')
      }
      done()
    }, done)
  })

  it('should support string errors', function (done) {
    var error = 'test'
    helper.httpTest(emitter, function (done) {
      ao.reportError(error)
      done()
    }, [
      function (msg) {
        msg.should.not.have.property('Layer')
        msg.should.have.property('Label', 'error')
        msg.should.have.property('ErrorClass', 'Error')
        msg.should.have.property('ErrorMsg', error)
        msg.should.have.property('Backtrace')
      }
    ], done)
  })

  it('should support empty string errors', function (done) {
    var error = ''
    helper.httpTest(emitter, function (done) {
      ao.reportError(error)
      done()
    }, [
      function (msg) {
        msg.should.not.have.property('Layer')
        msg.should.have.property('Label', 'error')
        msg.should.have.property('ErrorClass', 'Error')
        msg.should.have.property('ErrorMsg', error)
        msg.should.have.property('Backtrace')
      }
    ], done)
  })

  it('should fail silently when given non-error, non-string types', function () {
    var span = new Span('test', null, {})
    span._internal = function () {
      throw new Error('should not have triggered an _internal call')
    }
    span.error({ foo: 'bar' })
    span.error(undefined)
    span.error(new Date)
    span.error(/foo/)
    span.error(null)
    span.error([])
    span.error(1)
  })

  it('should allow sending the same error multiple times', function (done) {
    var error = new Error('dupe')

    // TODO: validate edge chaining
    function validate (msg) {
      msg.should.not.have.property('Layer')
      msg.should.have.property('Label', 'error')
      msg.should.have.property('ErrorClass', 'Error')
      msg.should.have.property('ErrorMsg', error.message)
      msg.should.have.property('Backtrace', error.stack)
    }

    helper.httpTest(emitter, function (done) {
      ao.reportError(error)
      ao.reportError(error)
      done()
    }, [ validate, validate ], done)
  })

  it('should not send error events when not in a span', function () {
    var span = new Span('test', null, {})

    var send = Event.prototype.send
    Event.prototype.send = function () {
      Event.prototype.send = send
      throw new Error('should not send when not in a span')
    }

    span.error(error)
    Event.prototype.send = send
  })

})
