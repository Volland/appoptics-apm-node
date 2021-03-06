'use strict'
const Emitter = require('events').EventEmitter
const helper = require('./helper')
const should = require('should')
const ao = require('..')
const Span = ao.Span
const Event = ao.Event

//
//                 ^     ^
//            __--| \:::/ |___
//    __---```   /    ;;;  \  ``---___
//      -----__ |   (@  \\  )       _-`
//             ```--___   \\ \   _-`
//                     ````----``
//     /````\  /```\   /```\  |`\   ||
//     ||``\| |/```\| |/```\| ||\\  ||
//      \\    ||   || ||   || || || ||
//        \\  ||   || ||   || || || ||
//     |\__|| |\___/| |\___/| ||  \\||
//     \____/  \___/   \___/  ||   \_|
//
const soon = global.setImmediate || process.nextTick

// Without the native liboboe bindings present,
// the custom instrumentation should be a no-op
if (!ao.addon) {
  describe('custom (without native bindings present)', function () {
    it('should passthrough sync instrument', function () {
      let counter = 0
      ao.instrument('test', function () {
        counter++
      })
      counter.should.equal(1)
    })
    it('should passthrough async instrument', function (done) {
      ao.instrument('test', soon, 'foo', done)
    })

    it('should passthrough sync startOrContinueTrace', function () {
      let counter = 0
      ao.startOrContinueTrace(null, 'test', function () {
        counter++
      })
      counter.should.equal(1)
    })
    it('should passthrough async startOrContinueTrace', function (done) {
      ao.startOrContinueTrace(null, 'test', soon, done)
    })

    it('should support callback shifting', function (done) {
      ao.instrument('test', soon, done)
    })

    it('should not fail when accessing traceId', function () {
      ao.traceId
    })
  })
  return
}

describe('custom', function () {
  const conf = {enabled: true}
  let emitter

  //
  // Intercept appoptics messages for analysis
  //
  beforeEach(function (done) {
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.sampleMode = 'always'
    emitter = helper.appoptics(done)
  })
  afterEach(function (done) {
    emitter.close(done)
  })

  // this test exists only to fix a problem with oboe not reporting a UDP
  // send failure.
  it('UDP might lose a message', function (done) {
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

  it('should custom instrument sync code', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument('test', function () {})
      done()
    }, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
      }
    ], done)
  })

  it('should custom instrument async code', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument('test', soon, done)
    }, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
      }
    ], done)
  })

  it('should support builder function', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument(function (last) {
        return last.descend('test', {
          Foo: 'bar'
        })
      }, soon, done)
    }, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
        msg.should.have.property('Foo', 'bar')
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
      }
    ], done)
  })

  it('should allow optional callback with async code', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument('test', function (doneInner) {
        soon(function () {
          doneInner()
          done()
        })
      })
    }, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
      }
    ], done)
  })

  it('should include backtrace, when collectBacktraces is on', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument('test', soon, {
        collectBacktraces: true,
        enabled: true
      }, done)
    }, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
        msg.should.have.property('Backtrace')
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
      }
    ], done)
  })

  it('should skip when not enabled', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument('test', soon, {
        enabled: false
      }, done)
    }, [], done)
  })

  it('should report custom info events within a span', function (done) {
    const data = {Foo: 'bar'}
    let last

    helper.test(emitter, function (done) {
      ao.instrument(function (span) {
        return span.descend('test')
      }, function (callback) {
        ao.reportInfo(data)
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
        msg.should.have.property('Label', 'info')
        msg.should.have.property('Foo', 'bar')
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

  it('should link info events correctly', function (done) {
    let outer
    const inner = []

    const checks = [
      // Outer entry
      function (msg) {
        msg.should.have.property('X-Trace', outer.events.entry.toString())
        msg.should.have.property('Layer', 'outer')
        msg.should.have.property('Label', 'entry')
      },
      // Inner entry #1 (async)
      function (msg) {
        msg.should.have.property('X-Trace', inner[0].events.entry.toString())
        msg.should.have.property('Edge', outer.events.entry.opId)
        msg.should.have.property('Layer', 'inner')
        msg.should.have.property('Label', 'entry')
      },
      // Inner info #1 (async)
      function (msg) {
        msg.should.have.property('X-Trace', inner[0].events.internal[0].toString())
        msg.should.have.property('Edge', inner[0].events.entry.opId)
        msg.should.not.have.property('Layer')
        msg.should.have.property('Label', 'info')
        msg.should.have.property('Index', 0)
      },
      // Outer info
      function (msg) {
        msg.should.have.property('X-Trace', outer.events.internal[0].toString())
        msg.should.have.property('Edge', outer.events.entry.opId)
        msg.should.not.have.property('Layer')
        msg.should.have.property('Label', 'info')
        msg.should.have.property('Index', 1)
      },
      // Inner entry #2 (async)
      function (msg) {
        msg.should.have.property('X-Trace', inner[1].events.entry.toString())
        msg.should.have.property('Edge', outer.events.internal[0].opId)
        msg.should.have.property('Layer', 'inner')
        msg.should.have.property('Label', 'entry')
      },
      // Inner info #2 (async)
      function (msg) {
        msg.should.have.property('X-Trace', inner[1].events.internal[0].toString())
        msg.should.have.property('Edge', inner[1].events.entry.opId)
        msg.should.not.have.property('Layer')
        msg.should.have.property('Label', 'info')
        msg.should.have.property('Index', 2)
      },
      // Outer exit
      function (msg) {
        msg.should.have.property('X-Trace', outer.events.exit.toString())
        msg.should.have.property('Edge', outer.events.internal[0].opId)
        msg.should.have.property('Layer', 'outer')
        msg.should.have.property('Label', 'exit')
      },
      // Inner exit #1 (async)
      function (msg) {
        msg.should.have.property('X-Trace', inner[0].events.exit.toString())
        msg.should.have.property('Edge', inner[0].events.internal[0].opId)
        msg.should.have.property('Layer', 'inner')
        msg.should.have.property('Label', 'exit')
      },
      // Inner exit #2 (async)
      function (msg) {
        msg.should.have.property('X-Trace', inner[1].events.exit.toString())
        msg.should.have.property('Edge', inner[1].events.internal[0].opId)
        msg.should.have.property('Layer', 'inner')
        msg.should.have.property('Label', 'exit')
      },
    ]

    helper.test(emitter, function (done) {
      function makeInner (data, done) {
        const span = Span.last.descend('inner')
        inner.push(span)
        span.run(function (wrap) {
          const delayed = wrap(done)
          ao.reportInfo(data)
          process.nextTick(function () {
            delayed()
          })
        })
      }

      outer = Span.last.descend('outer')
      outer.run(function () {
        const cb = after(2, done)
        makeInner({
          Index: 0
        }, cb)
        ao.reportInfo({
          Index: 1
        })
        makeInner({
          Index: 2
        }, cb)
      })
    }, checks, done)
  })

  it('should report partitioned spans', function (done) {
    const data = {Foo: 'bar', Partition: 'bar'}
    let last

    helper.test(emitter, function (done) {
      ao.instrument(function (span) {
        return span.descend('test')
      }, function (callback) {
        ao.reportInfo(data)
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
        msg.should.have.property('Label', 'info')
        msg.should.have.property('Foo', 'bar')
        msg.should.have.property('Partition', 'bar')
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

  it('should fail gracefully when invalid arguments are given', function (done) {
    helper.test(emitter, function (done) {
      function build (span) { return span.descend('test') }
      const expected = ['ibuild', 'irun', 'sbuild', 'srun']
      const found = []
      let i = 0
      function getInc () {
        const what = expected[i++]
        return function () {
          count++
          found.push(what)
        }
      }
      function run () {}
      let count = 0

      // Verify nothing bad happens when run function is missing
      ao.instrument(build)
      ao.startOrContinueTrace(null, build)

      // Verify nothing bad happens when build function is missing
      ao.instrument(null, run)
      ao.startOrContinueTrace(null, null, run)

      // Verify the runner is still run when builder fails to return a span
      ao.instrument(getInc(), getInc())
      ao.startOrContinueTrace(null, getInc(), getInc())
      found.should.deepEqual(expected)
      count.should.equal(4)

      done()
    }, [], done)
  })

  it('should handle errors correctly between build and run functions', function (done) {
    helper.test(emitter, function (done) {
      const err = new Error('nope')
      function build (span) { return span.descend('test') }
      function nope () { count++; throw err }
      function inc () { count++ }
      let count = 0

      // Verify errors thrown in builder do not propagate
      ao.instrument(nope, inc)
      ao.startOrContinueTrace(null, nope, inc)
      count.should.equal(4)

      // Verify that errors thrown in the runner function *do* propagate
      count = 0
      function validateError (e) { return e === err }
      should.throws(function () {
        ao.instrument(build, nope)
      }, validateError)
      should.throws(function () {
        ao.startOrContinueTrace(null, build, nope)
      }, validateError)
      count.should.equal(2)

      done()
    }, [], done)
  })

  // Verify startOrContinueTrace creates a new trace when not already tracing.
  it('should start a fresh trace for sync function', function (done) {
    let last

    helper.doChecks(emitter, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
        msg.should.have.property('SampleSource')
        msg.should.have.property('SampleRate')
        msg.should.not.have.property('Edge')
        last = msg['X-Trace'].substr(42, 16)
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
        msg.Edge.should.equal(last)
      }
    ], done)

    const test = 'foo'
    const res = ao.startOrContinueTrace(null, function (last) {
      return last.descend('test')
    }, function () {
      return test
    }, conf)

    res.should.equal(test)
  })

  // Verify startOrContinueTrace creates a new trace when not already tracing.
  it('should start a fresh trace for async function', function (done) {
    let last

    helper.doChecks(emitter, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
        msg.should.have.property('SampleSource')
        msg.should.have.property('SampleRate')
        msg.should.not.have.property('Edge')
        last = msg['X-Trace'].substr(42, 16)
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
        msg.Edge.should.equal(last)
      }
    ], done)

    const test = 'foo'
    const res = ao.startOrContinueTrace(
      null,                          // xtrace
      function (last) {              // span maker function
        return last.descend('test')
      },
      function (cb) {                // runner
        setTimeout(function () {cb(1, 2, 3, 5)}, 100)
        return test
      },
      conf,                          // configuration
      function callback () {
        arguments.should.have.property('0', 1)
        arguments.should.have.property('1', 2)
        arguments.should.have.property('2', 3)
        arguments.should.have.property('3', 5)
      }
    )

    res.should.equal(test)
  })

  // Verify startOrContinueTrace continues from provided trace id.
  it('should continue from previous trace id', function (done) {
    let last

    helper.doChecks(emitter, [
      function (msg) {
        msg.should.have.property('Layer', 'previous')
        msg.should.have.property('Label', 'entry')
        msg.should.not.have.property('Edge')
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
        msg.should.not.have.property('SampleSource')
        msg.should.not.have.property('SampleRate')
        msg.Edge.should.equal(entry.opId)
        last = msg['X-Trace'].substr(42, 16)
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
        msg.Edge.should.equal(last)
        last = msg['X-Trace'].substr(42, 16)
      },
      function (msg) {
        msg.should.have.property('Layer', 'previous')
        msg.should.have.property('Label', 'exit')
        msg.Edge.should.equal(last)
      }
    ], done)

    const previous = new Span('previous')
    const entry = previous.events.entry
    previous.async = true
    previous.enter()

    // Clear context
    Span.last = Event.last = null

    ao.startOrContinueTrace(entry.toString(), function (last) {
      return last.descend('test')
    }, function (cb) { cb() }, conf, function () {
      previous.exit()
    })
  })

  // Verify startOrContinueTrace continues from existing traces,
  // when already tracing, whether or not an xtrace if is provided.
  it('should continue outer traces when already tracing', function (done) {
    let prev, outer, sub

    helper.doChecks(emitter, [
      function (msg) {
        msg.should.have.property('Layer', 'previous')
        msg.should.have.property('Label', 'entry')
        msg.should.not.have.property('Edge')
        prev = msg['X-Trace'].substr(42, 16)
      },
      function (msg) {
        msg.should.have.property('Layer', 'outer')
        msg.should.have.property('Label', 'entry')
        // SampleSource and SampleRate should NOT be here due to continuation
        msg.should.not.have.property('SampleSource')
        msg.should.not.have.property('SampleRate')
        msg.should.have.property('Edge', prev)
        outer = msg['X-Trace'].substr(42, 16)
      },
      function (msg) {
        msg.should.have.property('Layer', 'inner')
        msg.should.have.property('Label', 'entry')
        // SampleSource and SampleRate should NOT be here due to continuation
        msg.should.not.have.property('SampleSource')
        msg.should.not.have.property('SampleRate')
        msg.should.have.property('Edge', outer)
        sub = msg['X-Trace'].substr(42, 16)
      },
      function (msg) {
        msg.should.have.property('Layer', 'inner')
        msg.should.have.property('Label', 'exit')
        msg.should.have.property('Edge', sub)
      },
      function (msg) {
        msg.should.have.property('Layer', 'outer')
        msg.should.have.property('Label', 'exit')
        msg.should.have.property('Edge', outer)
      },
      function (msg) {
        msg.should.have.property('Layer', 'previous')
        msg.should.have.property('Label', 'exit')
        msg.should.have.property('Edge', prev)
      }
    ], done)

    const previous = new Span('previous')
    const entry = previous.events.entry

    previous.run(function (wrap) {
      // Verify ID-less calls continue
      ao.startOrContinueTrace(null, 'outer', function (cb) {
        soon(function () {
          // Verify ID'd calls continue
          ao.startOrContinueTrace(entry.toString(), 'inner', function (cb) {
            cb()
          }, conf, cb)
        })
      }, conf, wrap(function () {}))
    })
  })

  // Verify startOrContinueTrace handles a false sample check correctly.
  it('should sample properly', function (done) {
    const realSample = ao.sample
    let called = false
    ao.sample = function () {
      called = true
      return {sample: true, source: 0, rate: 0}
    }

    helper.test(emitter, function (done) {
      Span.last = Event.last = null
      ao.startOrContinueTrace(null, 'test', setImmediate, conf, done)
    }, [], function (err) {
      called.should.equal(true)
      ao.sample = realSample
      done(err)
    })
  })

  // Verify traceId getter works correctly
  it('should get traceId when tracing and null when not', function () {
    should.not.exist(ao.traceId)
    ao.startOrContinueTrace(null, 'test', function (cb) {
      should.exist(ao.traceId)
      cb()
    }, function () {
      should.exist(ao.traceId)
    })
    should.not.exist(ao.traceId)
  })

  it('should bind functions to requestStore', function () {
    const bind = ao.requestStore.bind
    let threw = false
    let called = false

    ao.requestStore.bind = function () {
      called = true
    }

    function noop () {}

    try {
      ao.bind(noop)
      called.should.equal(false)
      const span = new Span('test')
      span.run(function () {
        ao.bind(null)
        called.should.equal(false)
        ao.bind(noop)
        called.should.equal(true)
      })
    } catch (e) {
      threw = true
    }

    ao.requestStore.bind = bind

    threw.should.equal(false)
  })

  it('should bind emitters to requestStore', function () {
    const bindEmitter = ao.requestStore.bindEmitter
    let threw = false
    let called = false

    ao.requestStore.bindEmitter = function () {
      called = true
    }

    const emitter = new Emitter()

    try {
      ao.bindEmitter(emitter)
      called.should.equal(false)
      const span = new Span('test', 'entry')
      span.run(function () {
        ao.bindEmitter(null)
        called.should.equal(false)
        ao.bindEmitter(emitter)
        called.should.equal(true)
      })
    } catch (e) {
      threw = true
    }

    ao.requestStore.bindEmitter = bindEmitter

    threw.should.equal(false)
  })

  it('should support instrumentHttp', function (done) {
    // Fake response object
    const res = new Emitter()
    res.end = res.emit.bind(res, 'end')
    let last

    helper.test(emitter, function (done) {
      ao.instrumentHttp(function (span) {
        return span.descend('test')
      }, function () {
        setImmediate(function () {
          res.end()
          done()
        })
      }, conf, res)
    }, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
        last = msg['X-Trace'].substr(42, 16)
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
        msg.Edge.should.equal(last)
      }
    ], done)
  })

})

function after (n, cb) {
  return function () {
    --n || cb()
  }
}
