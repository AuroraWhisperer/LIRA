'use strict';

class BilibiliUserProfileProvider {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async fetchProfile(uid) {
    const profile = await this.apiClient.fetchUserProfile(uid);
    return {
      name: profile && profile.name,
      avatarUrl: profile && profile.avatarUrl
    };
  }
}

module.exports = { BilibiliUserProfileProvider };
