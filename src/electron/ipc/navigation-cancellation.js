'use strict';

function createNavigationCancellation(cancel) {
  let owner = null;
  const navigation = (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) cancel();
  };

  function unbind() {
    owner?.removeListener('did-start-navigation', navigation);
    owner?.removeListener('destroyed', cancel);
    owner = null;
  }

  function bind(contents) {
    if (owner === contents) return;
    unbind();
    owner = contents;
    owner.on('did-start-navigation', navigation);
    owner.on('destroyed', cancel);
  }

  return { bind, unbind };
}

module.exports = { createNavigationCancellation };
