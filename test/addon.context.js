var helper = require('./helper')
var oboe = require('..').addon

describe('addon.context', function () {
  // Yes, this is really, actually needed.
  // Sampling may actually prevent reporting,
  // if the tests run too fast. >.<
  beforeEach(function (done) {
    helper.padTime(done)
  })

  it('should initialize', function () {
    oboe.Context.init()
  })

  it('should set tracing mode to never', function () {
    oboe.Context.setTracingMode(oboe.TRACE_NEVER)
  })
  it('should set tracing mode to always', function () {
    oboe.Context.setTracingMode(oboe.TRACE_ALWAYS)
  })
  it('should set tracing mode to through', function () {
    oboe.Context.setTracingMode(oboe.TRACE_THROUGH)
  })
  it('should set tracing mode to an out-of-range input', function () {
    try {
      oboe.Context.setTracingMode(3)
    } catch (e) {
      if (e.message === 'Invalid tracing mode') {
        return
      }
    }

    throw new Error('setTracingMode should fail on invalid inputs')
  })
  it('should set tracing mode to an invalid input', function () {
    try {
      oboe.Context.setTracingMode('foo')
    } catch (e) {
      if (e.message === 'Tracing mode must be a number') {
        return
      }
    }

    throw new Error('setTracingMode should fail on invalid inputs')
  })

  it('should set valid sample rate', function () {
    oboe.Context.setDefaultSampleRate(oboe.MAX_SAMPLE_RATE / 10)
  })
  it('should set invalid sample rate', function () {
    try {
      oboe.Context.setDefaultSampleRate(oboe.MAX_SAMPLE_RATE + 1)
    } catch (e) {
      if (e.message === 'Sample rate out of range') {
        return
      }
    }

    throw new Error('setDefaultSampleRate should fail on invalid inputs')
  })

  it('should check if a request should be sampled', function () {
    oboe.Context.setTracingMode(oboe.TRACE_ALWAYS)
    oboe.Context.setDefaultSampleRate(oboe.MAX_SAMPLE_RATE)
    var check = oboe.Context.sampleRequest('a', 'b', 'c')
    check.should.be.an.instanceof(Array)
    check.should.have.property(0, 1)
    check.should.have.property(1, 1)
    check.should.have.property(2, oboe.MAX_SAMPLE_RATE)
  })

  it('should serialize context to string', function () {
    oboe.Context.clear()
    var string = oboe.Context.toString()
    string.should.equal('1B00000000000000000000000000000000000000000000000000000000')
  })
  it('should set context to metadata instance', function () {
    var event = oboe.Context.createEvent()
    var metadata = event.getMetadata()
    oboe.Context.set(metadata)
    var v = oboe.Context.toString()
    v.should.not.equal('')
    v.should.equal(metadata.toString())
  })
  it('should set context from metadata string', function () {
    var event = oboe.Context.createEvent()
    var string = event.getMetadata().toString()
    oboe.Context.set(string)
    var v = oboe.Context.toString()
    v.should.not.equal('')
    v.should.equal(string)
  })
  it('should copy context to metadata instance', function () {
    var metadata = oboe.Context.copy()
    var v = oboe.Context.toString()
    v.should.not.equal('')
    v.should.equal(metadata.toString())
  })
  it('should clear the context', function () {
    var string = '1B00000000000000000000000000000000000000000000000000000000'
    oboe.Context.toString().should.not.equal(string)
    oboe.Context.clear()
    oboe.Context.toString().should.equal(string)
  })

  it('should create an event from the current context', function () {
    var event = oboe.Context.createEvent()
    event.should.be.an.instanceof(oboe.Event)
  })
  it('should start a trace from the current context', function () {
    var event = oboe.Context.startTrace()
    event.should.be.an.instanceof(oboe.Event)
  })

  it('should be invalid when empty', function () {
    oboe.Context.clear()
    oboe.Context.isValid().should.equal(false)
  })
  it('should be valid when not empty', function () {
    var event = oboe.Context.startTrace()
    oboe.Context.isValid().should.equal(true)
  })
})
