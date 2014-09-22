var debug = require('debug')('traceview:layer')
var extend = require('util')._extend
var Event = require('./event')
var addon = require('./addon')
var tv = require('./')

// Export the layer class
module.exports = Layer

/**
 * Create an execution layer.
 *
 * Usage:
 *
 *   // Sync tracing
 *   fs.readFileSync = (function (func) {
 *     return function () {
 *       var args = Array.prototype.slice.call(arguments)
 *       var buf
 *
 *       var layer = new Layer('fs')
 *       layer.run(function () {
 *         buf = func.apply(null, args)
 *       })
 *
 *       return buf
 *     }
 *   })(fs.readFileSync)
 *
 *   // Async tracing
 *   fs.readFile = (function (func) {
 *     return function () {
 *       var args = Array.prototype.slice.call(arguments)
 *       var cb = args.pop()
 *
 *       var layer = new Layer('fs')
 *       layer.run(function (wrap) {
 *         args.push(wrap(cb))
 *         func.apply(fs, args)
 *       })
 *     }
 *   })(fs.readFile)
 *
 * @class Layer
 * @constructor
 * @param {String} name Layer name
 * @param {String} parent Event or X-Trace ID to continue from
 * @param {Object} data Key/Value pairs of info to add to event
 */
function Layer (name, parent, data) {
  data = data || {}
  this.name = name

  // If we have a parent, set it to be the context
  if (typeof parent === 'string') {
    addon.Context.set(parent)
    debug('contuining ' + name + ' layer from ' + parent)
  } else if (parent && parent.event) {
    this.parent = parent
    parent.enter()
    debug('contuining ' + name + ' layer from ' + parent.event)
  }

  // Keep the context clean
  var context = addon.Context.toString()

  // Construct blank entry and exit events.
  var entry = new Event(name, 'entry', parent && context)
  var exit = new Event(name, 'exit', entry.event)

  // Add info to entry event, if available
  extend(entry, data)

  // Store the events for later use
  this.events = {
    entry: entry,
    exit: exit
  }
}

/**
 * Find the last entered layer in the active context
 */
Layer.__defineGetter__('last', function () {
  var last
  try {
    last = tv.requestStore.get('lastLayer')
  } catch (e) {
    debug('Can not access continuation-local-storage. Context may be lost.')
  }
  return last
})
Layer.__defineSetter__('last', function (value) {
  try {
    tv.requestStore.set('lastLayer', value)
  } catch (e) {
    debug('Can not access continuation-local-storage. Context may be lost.')
  }
})

/**
 * Create a new layer descending from the current layer
 *
 * @method descend
 * @param {String} name Layer name
 * @param {Object} data Key/Value pairs of info to add to event
 */
Layer.prototype.descend = function (name, data) {
  debug('descending ' + name + ' layer from ' + Event.last.event)
  var layer = new Layer(name, Event.last, data)
  layer.descended = true
  return layer
}

/**
 * Add a setter/getter to flag a layer as async
 */
Layer.prototype.__defineSetter__('async', function (val) {
  this._async = val
  if (val) {
    this.events.entry.Async = true
  } else {
    delete this.events.entry.Async
  }
  debug(this.name + ' layer ' + (val ? 'enabled' : 'disabled') + ' async')
})
Layer.prototype.__defineGetter__('async', function () {
  return this._async
})

/**
 * Run a function within the context of this layer.
 * NOTE: Similar to mocha, this identifies asynchrony by function arity.
 *
 * @method run
 * @param {Function} fn A function to run withing the layer context
 */
Layer.prototype.run = function (fn) {
  this.async = fn.length === 1
  var layer = this
  var run
  var ret

  run = function (action) {
    action()
  }

  // Run outer-most layer within the continuation-local-storage runner
  if ( ! this.descended || this.async) {
    run = function (action) {
      tv.requestStore.run(action)
    }
  }

  // Run the function while pinning sync entry/exit,
  // and supply wrapper to pin async entry/exit
  if (this.async) {
    run(function () {
      layer.enter()
      ret = fn.call(layer, function (cb, data) {
        return tv.requestStore.bind(function (err) {
          if (err && err instanceof Error) {
            layer.events.exit.error = err
          }
          layer.exit(data)
          return cb.apply(this, arguments)
        })
      })
    })

  // Otherwise, just run it as-is
  } else {
    run(function () {
      layer.enter()
      ret = fn.call(layer)
      layer.exit()
    })
  }

  return ret
}

/**
 * Send the enter event
 *
 * @method enter
 * @param {Object} data Key/Value pairs of info to add to event
 */
Layer.prototype.enter = function (data) {
  Layer.last = this
  debug(this.name + ' layer entered call')

  var entry = this.events.entry

  // Mixin data, when available
  extend(entry, data || {})

  // Send the entry event
  entry.send()
}

/**
 * Send the exit event
 *
 * @method exit
 * @param {Object} data Key/Value pairs of info to add to event
 */
Layer.prototype.exit = function (data) {
  debug(this.name + ' layer exited call')

  var exit = this.events.exit

  // Edge back to previous event, if not already connected
  if ( ! this.async && Event.last !== this.events.entry && ! exit.ignore) {
    exit.edges.push(Event.last)
  }

  // Mixin data, when available
  extend(exit, data || {})

  // Send the exit event
  exit.send()
}
