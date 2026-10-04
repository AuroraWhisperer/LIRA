'use strict';

// publish-release verifies the final installer before any tag or asset is published.
// Standalone builds retain the package.json verification hook.
module.exports = {
  ...require('../package.json').build,
  artifactBuildCompleted: null,
};
