'use strict';

const { createOvertimeService } = require('./overtime-service');
const { createOvertimeConsumer } = require('./overtime-consumer');
const contract = require('./overtime-contract');

module.exports = {
  ...contract,
  createOvertimeService,
  createOvertimeConsumer,
};
