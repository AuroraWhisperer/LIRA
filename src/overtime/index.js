'use strict';

const { createOvertimeService } = require('./overtime-service');
const { createOvertimeStore } = require('./overtime-store');
const { createOvertimeConsumer } = require('./overtime-consumer');
const contract = require('./overtime-contract');

module.exports = {
  ...contract,
  createOvertimeService,
  createOvertimeStore,
  createOvertimeConsumer,
};
