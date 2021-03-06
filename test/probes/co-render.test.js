var helper = require('../helper')
var ao = helper.ao

var pkg
try {
  pkg = require('co-render/package')
} catch (e) {
  pkg = {version: '0.0.0'}
}

// Check for generator support
var canGenerator = false
try {
  eval('(function* () {})()')
  canGenerator = true
} catch (e) {
}

function noop () {}

describe('probes/co-render ' + pkg.version, function () {
  var emitter
  var tests = canGenerator && require('./koa')

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    ao.probes.fs.enabled = false
    emitter = helper.appoptics(done)
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.sampleMode = 'always'
  })
  after(function (done) {
    ao.probes.fs.enabled = true
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

  //
  // Tests
  //
  if ( ! canGenerator) {
    it.skip('should support co-render', noop)
    it.skip('should skip when disabled', noop)
  } else {
    it('should support co-render', function (done) {
      tests.render(emitter, done)
    })
    it('should skip when disabled', function (done) {
      tests.render_disabled(emitter, done)
    })
  }
})
