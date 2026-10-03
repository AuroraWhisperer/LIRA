'use strict';

function toRankIdentityHint(userMeta) {
  return {
    uid: userMeta.uid,
    name: userMeta.userName,
    avatarUrl: userMeta.avatarUrl,
    roomIdentity: {
      guardKnown: userMeta.currentRoomVerified === true,
      guardLevel: userMeta.guardLevel,
      medalKnown: userMeta.currentRoomVerified === true,
      fansMedal: userMeta.medalName
        ? {
            name: userMeta.medalName,
            level: userMeta.medalLevel,
            targetUid: userMeta.medalTargetUid,
          }
        : null,
    },
  };
}

module.exports = { toRankIdentityHint };
