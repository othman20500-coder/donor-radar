'use strict';

// Explicit entry for hosting loaders that require() their startup file.
// This works without relying on a Passenger-specific global variable.
module.exports = require('./app.js').start();
