const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v10';

export interface GuildScheduledEvent {
  id: string;
  guild_id: string;
  channel_id: string | null;
  creator_id: string;
  name: string;
  description: string | null;
  scheduled_start_time: string;
  scheduled_end_time: string | null;
  entity_type: number; // 1=stage, 2=voice, 3=external
  entity_metadata: Record<string, unknown>;
  status: number; // 1=scheduled, 2=active, 3=completed, 4=canceled
  privacy_level: number;
  interested_count?: number;
}

export interface GuildScheduledEventCreate {
  name: string;
  scheduled_start_time: string;
  scheduled_end_time?: string | null;
  description?: string;
  entity_type?: number;
  channel_id?: string | null;
}

export interface NotificationSettings {
  guild_id: string | null;
  channel_id: string | null;
  muted: boolean;
  message_notifications: number; // 0=all, 1=mentions, 2=nothing
  suppress_everyone: boolean;
  suppress_roles: boolean;
}

export interface NotificationSettingsUpdate {
  muted?: boolean;
  message_notifications?: number;
  suppress_everyone?: boolean;
  suppress_roles?: boolean;
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string) { this.token = token; }
  clearToken() { this.token = null; }

  /**
   * Turn a non-2xx Response into a thrown error. The body is usually JSON
   * ({ code, message, ... }), but a proxy/timeout/5xx can return HTML or an
   * empty body — parsing that as JSON throws a SyntaxError that masks the real
   * HTTP error. Parse defensively and fall back to a synthetic error built from
   * the status. Always attaches `status` so callers (e.g. the startup loader)
   * can distinguish an auth failure (401) from a transient/server error.
   */
  private async throwFromResponse(res: Response): Promise<never> {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { message: res.statusText || `Request failed with status ${res.status}` };
    }
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const err = body as Record<string, unknown>;
      if (err.status === undefined) err.status = res.status;
      throw err;
    }
    throw {
      status: res.status,
      message: typeof body === 'string' && body
        ? body
        : (res.statusText || `Request failed with status ${res.status}`),
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) await this.throwFromResponse(res);
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  private async requestForm<T>(method: string, path: string, formData: FormData): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: formData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) await this.throwFromResponse(res);
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  // Auth
  register(data: { username: string; email: string; password: string; global_name?: string; date_of_birth: string; consent: boolean }) {
    return this.request<{ token: string }>('POST', '/auth/register', data);
  }
  login(data: { email: string; password: string }) {
    return this.request<{ token: string }>('POST', '/auth/login', data);
  }
  getMe() {
    return this.request<{
      id: string; username: string; global_name: string | null; email: string;
      avatar: string | null; bio: string | null; accent_color: number | null;
      pronouns: string; mfa_enabled: boolean; locale: string; flags: number; premium_type: number;
    }>('GET', '/users/@me');
  }

  // Guilds
  getMyGuilds() { return this.request<Array<{ id: string; name: string; icon: string | null; owner_id: string; member_count: number }>>('GET', '/users/@me/guilds'); }
  createGuild(data: { name: string }) { return this.request<any>('POST', '/guilds', data); }
  getGuild(id: string) { return this.request<any>('GET', `/guilds/${id}`); }
  getGuildChannels(id: string) { return this.request<any[]>('GET', `/guilds/${id}/channels`); }
  getGuildMembers(id: string) { return this.request<any[]>('GET', `/guilds/${id}/members`); }

  // Channels
  getMessages(channelId: string, params?: { before?: string; after?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.before) query.set('before', params.before);
    if (params?.after) query.set('after', params.after);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.request<any[]>('GET', `/channels/${channelId}/messages${qs ? '?' + qs : ''}`);
  }
  sendMessage(channelId: string, data: { content: string; nonce?: string; message_reference?: { message_id: string } }) {
    return this.request<Record<string, unknown>>('POST', `/channels/${channelId}/messages`, data);
  }
  async sendMessageWithAttachments(channelId: string, content: string, files: File[]): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const formData = new FormData();
    if (content) formData.append('content', content);
    files.forEach((file, i) => {
      formData.append(`files[${i}]`, file, file.name);
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let res: Response;
    try {
      res = await fetch(`${API_URL}/channels/${channelId}/messages`, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) await this.throwFromResponse(res);
    return res.json() as Promise<Record<string, unknown>>;
  }
  editMessage(channelId: string, messageId: string, data: { content: string }) {
    return this.request<Record<string, unknown>>('PATCH', `/channels/${channelId}/messages/${messageId}`, data);
  }
  deleteMessage(channelId: string, messageId: string) {
    return this.request<void>('DELETE', `/channels/${channelId}/messages/${messageId}`);
  }
  bulkDeleteMessages(channelId: string, messageIds: string[]) {
    return this.request<void>('POST', `/channels/${channelId}/messages/bulk-delete`, { messages: messageIds });
  }
  sendTyping(channelId: string) { return this.request<void>('POST', `/channels/${channelId}/typing`); }
  pinMessage(channelId: string, messageId: string) { return this.request<void>('PUT', `/channels/${channelId}/pins/${messageId}`); }
  unpinMessage(channelId: string, messageId: string) { return this.request<void>('DELETE', `/channels/${channelId}/pins/${messageId}`); }
  getPinnedMessages(channelId: string) {
    return this.request<Array<{
      id: string;
      channel_id: string;
      author: { id: string; username: string; avatar: string | null };
      content: string;
      timestamp: string;
      edited_timestamp: string | null;
      pinned: boolean;
      attachments?: Array<{ id: string; filename: string; size: number; url: string; content_type?: string; width?: number; height?: number }>;
      embeds?: Array<Record<string, unknown>>;
    }>>('GET', `/channels/${channelId}/pins`);
  }

  createChannel(guildId: string, data: { name: string; type: number; parent_id?: string }) {
    return this.request<{ id: string; guild_id: string; type: number; name: string; topic: string | null; position: number; parent_id: string | null }>('POST', `/guilds/${guildId}/channels`, data);
  }

  // Reactions
  addReaction(channelId: string, messageId: string, emoji: string) {
    const encoded = encodeURIComponent(emoji);
    return this.request<void>('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`);
  }
  removeReaction(channelId: string, messageId: string, emoji: string) {
    const encoded = encodeURIComponent(emoji);
    return this.request<void>('DELETE', `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`);
  }

  getReactions(channelId: string, messageId: string, emoji: string, limit = 100) {
    const encoded = encodeURIComponent(emoji);
    return this.request<Array<{ id: string; username: string; avatar: string | null }>>('GET', `/channels/${channelId}/messages/${messageId}/reactions/${encoded}?limit=${limit}`);
  }

  // Invites
  createInvite(channelId: string, options?: { max_age?: number; max_uses?: number }) {
    return this.request<{ code: string; channel: { id: string }; guild: { id: string; name: string }; max_age: number; max_uses: number; uses: number }>('POST', `/channels/${channelId}/invites`, options ?? {});
  }
  getInvite(code: string) {
    return this.request<{ code: string; guild: { id: string; name: string; icon: string | null }; channel: { id: string; name: string } }>('GET', `/invites/${code}`);
  }
  joinGuild(code: string) {
    return this.request<{ guild: { id: string; name: string; icon: string | null; owner_id: string; member_count: number } }>('POST', `/invites/${code}`);
  }

  // DM Channels
  getDmChannels() {
    return this.request<Array<{ id: string; type: number; recipients: Array<{ id: string; username: string; avatar: string | null }>; last_message_id: string | null }>>('GET', '/users/@me/channels');
  }
  createDm(recipientId: string) {
    return this.request<{ id: string; type: number; recipients: Array<{ id: string; username: string; avatar: string | null }>; last_message_id: string | null }>('POST', '/users/@me/channels', { recipient_id: recipientId });
  }
  createGroupDm(recipientIds: string[]) {
    return this.request<{ id: string; type: number; recipients: Array<{ id: string; username: string; avatar: string | null }>; last_message_id: string | null }>('POST', '/users/@me/channels', { recipients: recipientIds });
  }

  // Search
  searchMessages(guildId: string, params: {
    content?: string;
    author_id?: string;
    channel_id?: string;
    has?: string;
    before?: string;
    after?: string;
    limit?: number;
    offset?: number;
  }) {
    const query = new URLSearchParams();
    if (params.content) query.set('content', params.content);
    if (params.author_id) query.set('author_id', params.author_id);
    if (params.channel_id) query.set('channel_id', params.channel_id);
    if (params.has) query.set('has', params.has);
    if (params.before) query.set('before', params.before);
    if (params.after) query.set('after', params.after);
    if (params.limit != null) query.set('limit', String(params.limit));
    if (params.offset != null) query.set('offset', String(params.offset));
    const qs = query.toString();
    return this.request<{
      messages: Array<Array<{
        id: string;
        channel_id: string;
        guild_id: string;
        author: { id: string; username: string; avatar: string | null };
        content: string;
        timestamp: string;
        hit: boolean;
      }>>;
      total_results: number;
    }>('GET', `/guilds/${guildId}/messages/search${qs ? '?' + qs : ''}`);
  }

  // Forum channels
  getForumThreads(channelId: string, params?: { sort?: 'latest_activity' | 'creation_date'; tag_id?: string; before?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.sort) query.set('sort', params.sort);
    if (params?.tag_id) query.set('tag_id', params.tag_id);
    if (params?.before) query.set('before', params.before);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.request<{
      threads: Array<{
        id: string;
        guild_id: string | null;
        type: number;
        name: string | null;
        parent_id: string | null;
        owner_id: string | null;
        last_message_id: string | null;
        message_count: number;
        member_count: number;
        thread_metadata: { archived: boolean; auto_archive_duration: number; archive_timestamp: string | null; locked: boolean; create_timestamp: string } | null;
        author?: { id: string; username: string; avatar: string | null };
        applied_tags: string[];
        last_activity: string | null;
      }>;
      has_more: boolean;
    }>('GET', `/channels/${channelId}/threads/active${qs ? '?' + qs : ''}`);
  }
  createForumPost(channelId: string, data: { name: string; message: { content: string }; applied_tags?: string[] }) {
    return this.request<Record<string, unknown>>('POST', `/channels/${channelId}/threads`, {
      name: data.name,
      message: data.message,
    });
  }
  getForumTags(channelId: string) {
    return this.request<Array<{ id: string; name: string; emoji_name?: string; emoji_id?: string }>>('GET', `/channels/${channelId}/tags`);
  }
  setForumTags(channelId: string, tags: Array<{ id: string; name: string; emoji_name?: string; emoji_id?: string }>) {
    return this.request<Array<{ id: string; name: string; emoji_name?: string; emoji_id?: string }>>('PUT', `/channels/${channelId}/tags`, tags);
  }

  // Guild management
  updateGuild(guildId: string, data: { name?: string; description?: string; icon?: string | null; region?: string; verification_level?: number; explicit_content_filter?: number; discoverable?: boolean }) {
    return this.request<{ id: string; name: string; icon: string | null; owner_id: string; description: string | null }>('PATCH', `/guilds/${guildId}`, data);
  }
  transferOwnership(guildId: string, newOwnerId: string) {
    return this.request<{ id: string; name: string; icon: string | null; owner_id: string; description: string | null }>('PATCH', `/guilds/${guildId}`, { owner_id: newOwnerId });
  }
  deleteGuild(guildId: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}`);
  }
  leaveGuild(guildId: string) {
    return this.request<void>('DELETE', `/users/@me/guilds/${guildId}`);
  }

  // Roles
  getGuildRoles(guildId: string) {
    return this.request<Array<{ id: string; name: string; color: number; hoist: boolean; position: number; permissions: string; managed: boolean; mentionable: boolean }>>('GET', `/guilds/${guildId}/roles`);
  }
  createRole(guildId: string, data?: { name?: string; color?: number; permissions?: string; hoist?: boolean; mentionable?: boolean }) {
    return this.request<{ id: string; name: string; color: number; hoist: boolean; position: number; permissions: string; managed: boolean; mentionable: boolean }>('POST', `/guilds/${guildId}/roles`, data ?? {});
  }
  updateRole(guildId: string, roleId: string, data: { name?: string; color?: number; permissions?: string; hoist?: boolean; mentionable?: boolean; position?: number }) {
    return this.request<{ id: string; name: string; color: number; hoist: boolean; position: number; permissions: string; managed: boolean; mentionable: boolean }>('PATCH', `/guilds/${guildId}/roles/${roleId}`, data);
  }
  deleteRole(guildId: string, roleId: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/roles/${roleId}`);
  }

  // Channel management
  updateChannel(channelId: string, data: { name?: string; topic?: string; nsfw?: boolean; rate_limit_per_user?: number; bitrate?: number; user_limit?: number; rtc_region?: string | null; video_quality_mode?: number }) {
    return this.request<{ id: string; guild_id: string; type: number; name: string; topic: string | null; position: number; nsfw: boolean; rate_limit_per_user: number; bitrate?: number; user_limit?: number; rtc_region?: string | null; video_quality_mode?: number }>('PATCH', `/channels/${channelId}`, data);
  }
  deleteChannel(channelId: string) {
    return this.request<void>('DELETE', `/channels/${channelId}`);
  }

  // Channel permission overwrites
  getChannelPermissionOverwrites(channelId: string): Promise<Array<{ id: string; type: number; allow: string; deny: string }>> {
    return this.request<Record<string, unknown>>('GET', `/channels/${channelId}`).then(
      (channel) => {
        const overwrites = channel['permission_overwrites'];
        if (Array.isArray(overwrites)) {
          return overwrites as Array<{ id: string; type: number; allow: string; deny: string }>;
        }
        return [];
      }
    );
  }
  setChannelPermissionOverwrite(channelId: string, overwriteId: string, data: { type: number; allow: string; deny: string }) {
    return this.request<void>('PUT', `/channels/${channelId}/permissions/${overwriteId}`, data);
  }
  deleteChannelPermissionOverwrite(channelId: string, overwriteId: string) {
    return this.request<void>('DELETE', `/channels/${channelId}/permissions/${overwriteId}`);
  }

  // Channel invites
  getChannelInvites(channelId: string) {
    return this.request<Array<{
      code: string;
      channel: { id: string; name: string };
      inviter?: { id: string; username: string; avatar: string | null };
      uses: number;
      max_uses: number;
      max_age: number;
      temporary: boolean;
      created_at: string;
    }>>('GET', `/channels/${channelId}/invites`);
  }

  // Channel webhooks
  getChannelWebhooks(channelId: string) {
    return this.request<Array<{
      id: string;
      name: string;
      avatar: string | null;
      channel_id: string;
      guild_id: string;
      token?: string;
      type: number;
      user?: { id: string; username: string; avatar: string | null };
    }>>('GET', `/channels/${channelId}/webhooks`);
  }
  createWebhook(channelId: string, data: { name: string; avatar?: string | null }) {
    return this.request<{
      id: string;
      name: string;
      avatar: string | null;
      channel_id: string;
      guild_id: string;
      token?: string;
      type: number;
      user?: { id: string; username: string; avatar: string | null };
      created_at?: string;
    }>('POST', `/channels/${channelId}/webhooks`, data);
  }
  updateWebhook(webhookId: string, data: { name?: string; avatar?: string | null; channel_id?: string }) {
    return this.request<{
      id: string;
      name: string;
      avatar: string | null;
      channel_id: string;
      guild_id: string;
      token?: string;
      type: number;
    }>('PATCH', `/webhooks/${webhookId}`, data);
  }
  deleteWebhook(webhookId: string) {
    return this.request<void>('DELETE', `/webhooks/${webhookId}`);
  }
  getGuildWebhooks(guildId: string) {
    return this.request<Array<{
      id: string;
      name: string;
      avatar: string | null;
      channel_id: string;
      guild_id: string;
      token?: string;
      type: number;
      user?: { id: string; username: string; avatar: string | null };
    }>>('GET', `/guilds/${guildId}/webhooks`);
  }

  // Bans
  getGuildBans(guildId: string) {
    return this.request<Array<{ user: { id: string; username: string; avatar: string | null }; reason: string | null }>>('GET', `/guilds/${guildId}/bans`);
  }
  createBan(guildId: string, userId: string, data?: { reason?: string; delete_message_days?: number }) {
    return this.request<void>('PUT', `/guilds/${guildId}/bans/${userId}`, data ?? {});
  }
  removeBan(guildId: string, userId: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/bans/${userId}`);
  }

  // Member management
  kickMember(guildId: string, userId: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/members/${userId}`);
  }
  addMemberRole(guildId: string, userId: string, roleId: string) {
    return this.request<void>('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  }
  removeMemberRole(guildId: string, userId: string, roleId: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  }
  updateMemberNick(guildId: string, userId: string, nick: string | null) {
    return this.request<void>('PATCH', `/guilds/${guildId}/members/${userId}`, { nick });
  }

  // Audit log
  getAuditLog(guildId: string, params?: { limit?: number; before?: string; action_type?: number }) {
    const query = new URLSearchParams();
    if (params?.limit != null) query.set('limit', String(params.limit));
    if (params?.before) query.set('before', params.before);
    if (params?.action_type != null) query.set('action_type', String(params.action_type));
    const qs = query.toString();
    return this.request<{
      audit_log_entries: Array<{
        id: string;
        user_id: string;
        target_id: string | null;
        action_type: number;
        changes?: Array<{ key: string; old_value?: unknown; new_value?: unknown }>;
        reason?: string;
        created_at: string;
      }>;
      users: Array<{ id: string; username: string; avatar: string | null }>;
    }>('GET', `/guilds/${guildId}/audit-logs${qs ? '?' + qs : ''}`);
  }

  // Guild invites
  getGuildInvites(guildId: string) {
    return this.request<Array<{
      code: string;
      channel: { id: string; name: string };
      inviter?: { id: string; username: string; avatar: string | null };
      uses: number;
      max_uses: number;
      max_age: number;
      temporary: boolean;
      created_at: string;
    }>>('GET', `/guilds/${guildId}/invites`);
  }
  revokeInvite(code: string) {
    return this.request<void>('DELETE', `/invites/${code}`);
  }

  // User profile
  getUserProfile(userId: string) {
    return this.request<{
      id: string;
      username: string;
      global_name: string | null;
      avatar: string | null;
      banner: string | null;
      bio: string | null;
      accent_color: number | null;
      pronouns: string;
      mutual_guilds: Array<{ id: string; name: string; icon: string | null }>;
      mutual_friends_count: number;
    }>('GET', `/users/${userId}/profile`);
  }
  updateUser(data: { username?: string; email?: string; avatar?: string | null; banner?: string | null; global_name?: string; bio?: string; accent_color?: number | null; pronouns?: string }) {
    return this.request<{ id: string; username: string; email: string; avatar: string | null; banner?: string | null; global_name?: string; bio?: string; accent_color?: number | null; pronouns?: string }>('PATCH', '/users/@me', data);
  }
  changePassword(data: { old_password: string; new_password: string }) {
    return this.request<void>('PATCH', '/users/@me', data);
  }
  deleteAccount(data: { password: string }) {
    return this.request<void>('POST', '/users/@me/delete', data);
  }

  // Auth
  logout() { return this.request<void>('POST', '/auth/logout'); }
  verifyEmail(token: string) {
    return this.request<{ message: string }>('POST', '/auth/verify', { token });
  }
  forgotPassword(email: string) {
    return this.request<void>('POST', '/auth/forgot-password', { email });
  }
  resetPassword(token: string, new_password: string) {
    return this.request<{ message: string }>('POST', '/auth/reset-password', { token, new_password });
  }

  // User settings
  getSettings() { return this.request<Record<string, unknown>>('GET', '/users/@me/settings'); }
  updateSettings(data: Record<string, unknown>) { return this.request<Record<string, unknown>>('PATCH', '/users/@me/settings', data); }

  // Notification settings
  getGuildNotificationSettings(guildId: string) {
    return this.request<NotificationSettings>('GET', `/users/@me/guilds/${guildId}/notification-settings`);
  }
  updateGuildNotificationSettings(guildId: string, data: NotificationSettingsUpdate) {
    return this.request<NotificationSettings>('PATCH', `/users/@me/guilds/${guildId}/notification-settings`, data);
  }
  getChannelNotificationSettings(channelId: string) {
    return this.request<NotificationSettings>('GET', `/users/@me/channels/${channelId}/notification-settings`);
  }
  updateChannelNotificationSettings(channelId: string, data: NotificationSettingsUpdate) {
    return this.request<NotificationSettings>('PATCH', `/users/@me/channels/${channelId}/notification-settings`, data);
  }

  // Stage Instances
  createStageInstance(data: { channel_id: string; topic: string; privacy_level?: number }) {
    return this.request<{
      id: string;
      guild_id: string;
      channel_id: string;
      topic: string;
      privacy_level: number;
      discoverable_disabled: boolean;
      guild_scheduled_event_id: string | null;
    }>('POST', '/stage-instances', data);
  }
  updateStageInstance(channelId: string, data: { topic?: string; privacy_level?: number }) {
    return this.request<{
      id: string;
      guild_id: string;
      channel_id: string;
      topic: string;
      privacy_level: number;
      discoverable_disabled: boolean;
      guild_scheduled_event_id: string | null;
    }>('PATCH', `/stage-instances/${channelId}`, data);
  }
  deleteStageInstance(channelId: string) {
    return this.request<void>('DELETE', `/stage-instances/${channelId}`);
  }
  getStageInstance(channelId: string) {
    return this.request<{
      id: string;
      guild_id: string;
      channel_id: string;
      topic: string;
      privacy_level: number;
      discoverable_disabled: boolean;
      guild_scheduled_event_id: string | null;
    }>('GET', `/stage-instances/${channelId}`);
  }

  // Voice State Updates (for stage request to speak)
  updateVoiceState(guildId: string, data: { channel_id: string; suppress?: boolean; request_to_speak_timestamp?: string | null }) {
    return this.request<void>('PATCH', `/guilds/${guildId}/voice-states/@me`, data);
  }

  // Announcement Channel - Follow / Crosspost
  followAnnouncementChannel(channelId: string, data: { webhook_channel_id: string }) {
    return this.request<{ channel_id: string; webhook_id: string }>('POST', `/channels/${channelId}/followers`, data);
  }
  crosspostMessage(channelId: string, messageId: string) {
    return this.request<Record<string, unknown>>('POST', `/channels/${channelId}/messages/${messageId}/crosspost`);
  }

  // Guild discovery (public server browsing)
  discoverGuilds(params?: { query?: string; limit?: number }) {
    const q = new URLSearchParams();
    if (params?.query) q.set('query', params.query);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return this.request<Array<{ id: string; name: string; icon: string | null; description: string | null; member_count: number }>>('GET', `/guild-discovery${qs ? `?${qs}` : ''}`);
  }

  joinDiscoverableGuild(guildId: string) {
    return this.request<{ id: string; name: string; icon: string | null; owner_id: string; description: string | null }>('POST', `/guild-discovery/${guildId}/join`);
  }

  // Inbox mentions
  getMentions(limit = 50) {
    return this.request<Array<Record<string, unknown> & { guild_id: string | null }>>('GET', `/users/@me/mentions?limit=${limit}`);
  }

  // Relationships
  getRelationships() {
    return this.request<Array<{ id: string; type: number; user: { id: string; username: string; avatar: string | null; display_name?: string } }>>('GET', '/users/@me/relationships');
  }
  sendFriendRequest(username: string) {
    return this.request<void>('POST', '/users/@me/relationships', { username });
  }
  sendFriendRequestById(userId: string) {
    return this.request<void>('PUT', `/users/@me/relationships/${userId}`, { type: 1 });
  }
  acceptFriendRequest(userId: string) {
    return this.request<void>('PUT', `/users/@me/relationships/${userId}`, { type: 1 });
  }
  blockUser(userId: string) {
    return this.request<void>('PUT', `/users/@me/relationships/${userId}`, { type: 2 });
  }
  removeRelationship(userId: string) {
    return this.request<void>('DELETE', `/users/@me/relationships/${userId}`);
  }

  // Threads
  createThread(channelId: string, data: { name: string; auto_archive_duration?: number; type?: number }) {
    return this.request<Record<string, unknown>>('POST', `/channels/${channelId}/threads`, data);
  }
  createThreadFromMessage(channelId: string, messageId: string, data: { name: string; auto_archive_duration?: number; type?: number }) {
    return this.request<Record<string, unknown>>('POST', `/channels/${channelId}/messages/${messageId}/threads`, data);
  }
  getActiveThreads(channelId: string) {
    return this.request<{ threads: Array<Record<string, unknown>>; has_more: boolean }>('GET', `/channels/${channelId}/threads/active`);
  }
  getGuildActiveThreads(guildId: string) {
    return this.request<{ threads: Array<Record<string, unknown>>; has_more: boolean }>('GET', `/guilds/${guildId}/threads/active`);
  }
  joinThread(threadId: string) {
    return this.request<void>('PUT', `/channels/${threadId}/thread-members/@me`);
  }
  leaveThread(threadId: string) {
    return this.request<void>('DELETE', `/channels/${threadId}/thread-members/@me`);
  }
  updateThread(threadId: string, data: { name?: string; archived?: boolean; locked?: boolean; auto_archive_duration?: number }) {
    return this.request<Record<string, unknown>>('PATCH', `/channels/${threadId}`, data);
  }

  // AutoMod
  getAutoModRules(guildId: string) {
    return this.request<Array<{
      id: string;
      guild_id: string;
      name: string;
      event_type: number;
      trigger_type: number;
      trigger_metadata: { keyword_filter?: string[]; mention_total_limit?: number };
      actions: Array<{ type: number; metadata?: { channel_id?: string; duration_seconds?: number } }>;
      enabled: boolean;
      exempt_roles: string[];
      exempt_channels: string[];
    }>>('GET', `/guilds/${guildId}/auto-moderation/rules`);
  }
  createAutoModRule(guildId: string, data: {
    name: string;
    event_type: number;
    trigger_type: number;
    trigger_metadata: { keyword_filter?: string[]; mention_total_limit?: number };
    actions: Array<{ type: number; metadata?: { channel_id?: string; duration_seconds?: number } }>;
    enabled: boolean;
    exempt_roles?: string[];
    exempt_channels?: string[];
  }) {
    return this.request<{
      id: string;
      guild_id: string;
      name: string;
      event_type: number;
      trigger_type: number;
      trigger_metadata: { keyword_filter?: string[]; mention_total_limit?: number };
      actions: Array<{ type: number; metadata?: { channel_id?: string; duration_seconds?: number } }>;
      enabled: boolean;
      exempt_roles: string[];
      exempt_channels: string[];
    }>('POST', `/guilds/${guildId}/auto-moderation/rules`, data);
  }
  updateAutoModRule(guildId: string, ruleId: string, data: {
    name?: string;
    event_type?: number;
    trigger_metadata?: { keyword_filter?: string[]; mention_total_limit?: number };
    actions?: Array<{ type: number; metadata?: { channel_id?: string; duration_seconds?: number } }>;
    enabled?: boolean;
    exempt_roles?: string[];
    exempt_channels?: string[];
  }) {
    return this.request<{
      id: string;
      guild_id: string;
      name: string;
      event_type: number;
      trigger_type: number;
      trigger_metadata: { keyword_filter?: string[]; mention_total_limit?: number };
      actions: Array<{ type: number; metadata?: { channel_id?: string; duration_seconds?: number } }>;
      enabled: boolean;
      exempt_roles: string[];
      exempt_channels: string[];
    }>('PATCH', `/guilds/${guildId}/auto-moderation/rules/${ruleId}`, data);
  }
  deleteAutoModRule(guildId: string, ruleId: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/auto-moderation/rules/${ruleId}`);
  }

  // Guild Emoji
  getGuildEmojis(guildId: string) {
    return this.request<Array<{
      id: string;
      name: string;
      animated: boolean;
      available: boolean;
      managed: boolean;
      require_colons: boolean;
      roles: string[];
      user?: { id: string; username: string; avatar: string | null };
    }>>('GET', `/guilds/${guildId}/emojis`);
  }
  createGuildEmoji(guildId: string, data: { name: string; image: string; roles?: string[] }) {
    return this.request<{
      id: string;
      name: string;
      animated: boolean;
      available: boolean;
      managed: boolean;
      require_colons: boolean;
      roles: string[];
      user?: { id: string; username: string; avatar: string | null };
    }>('POST', `/guilds/${guildId}/emojis`, data);
  }
  deleteGuildEmoji(guildId: string, emojiId: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/emojis/${emojiId}`);
  }

  // Stickers
  getGuildStickers(guildId: string) {
    return this.request<unknown[]>('GET', `/guilds/${guildId}/stickers`);
  }
  createGuildSticker(guildId: string, formData: FormData) {
    return this.requestForm<unknown>('POST', `/guilds/${guildId}/stickers`, formData);
  }
  deleteGuildSticker(guildId: string, stickerId: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/stickers/${stickerId}`);
  }

  // Soundboard
  getGuildSoundboardSounds(guildId: string) {
    return this.request<unknown[]>('GET', `/guilds/${guildId}/soundboard-sounds`);
  }
  createGuildSoundboardSound(guildId: string, formData: FormData) {
    return this.requestForm<unknown>('POST', `/guilds/${guildId}/soundboard-sounds`, formData);
  }
  deleteGuildSoundboardSound(guildId: string, soundId: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/soundboard-sounds/${soundId}`);
  }
  playGuildSoundboardSound(guildId: string, soundId: string) {
    return this.request<void>('POST', `/guilds/${guildId}/soundboard-sounds/${soundId}/play`);
  }

  // Widget
  getGuildWidget(guildId: string) {
    return this.request<unknown>('GET', `/guilds/${guildId}/widget`);
  }
  updateGuildWidget(guildId: string, data: { enabled: boolean; channel_id: string | null }) {
    return this.request<unknown>('PATCH', `/guilds/${guildId}/widget`, data);
  }

  // Server Template
  getGuildTemplates(guildId: string) {
    return this.request<unknown[]>('GET', `/guilds/${guildId}/templates`);
  }
  createGuildTemplate(guildId: string, data: { name: string; description?: string }) {
    return this.request<unknown>('POST', `/guilds/${guildId}/templates`, data);
  }
  syncGuildTemplate(guildId: string, templateCode: string) {
    return this.request<unknown>('PUT', `/guilds/${guildId}/templates/${templateCode}`);
  }
  deleteGuildTemplate(guildId: string, templateCode: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/templates/${templateCode}`);
  }

  // Vanity URL
  getGuildVanityUrl(guildId: string) {
    return this.request<unknown>('GET', `/guilds/${guildId}/vanity-url`);
  }
  updateGuildVanityUrl(guildId: string, code: string) {
    return this.request<unknown>('PATCH', `/guilds/${guildId}/vanity-url`, { code });
  }

  // Scheduled events
  getGuildScheduledEvents(guildId: string) {
    return this.request<GuildScheduledEvent[]>('GET', `/guilds/${guildId}/scheduled-events`);
  }
  createGuildScheduledEvent(guildId: string, data: GuildScheduledEventCreate) {
    return this.request<GuildScheduledEvent>('POST', `/guilds/${guildId}/scheduled-events`, data);
  }
  updateGuildScheduledEvent(guildId: string, eventId: string, data: Partial<GuildScheduledEventCreate> & { status?: number }) {
    return this.request<GuildScheduledEvent>('PATCH', `/guilds/${guildId}/scheduled-events/${eventId}`, data);
  }
  rsvpScheduledEvent(guildId: string, eventId: string) {
    return this.request<void>('POST', `/guilds/${guildId}/scheduled-events/${eventId}/users/@me`);
  }
  unrsvpScheduledEvent(guildId: string, eventId: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/scheduled-events/${eventId}/users/@me`);
  }
  getScheduledEventInterested(guildId: string, eventId: string) {
    return this.request<{ user_ids: string[]; count: number }>('GET', `/guilds/${guildId}/scheduled-events/${eventId}/users`);
  }
  deleteGuildScheduledEvent(guildId: string, eventId: string) {
    return this.request<void>('DELETE', `/guilds/${guildId}/scheduled-events/${eventId}`);
  }

  // Welcome Screen
  getGuildWelcomeScreen(guildId: string) {
    return this.request<unknown>('GET', `/guilds/${guildId}/welcome-screen`);
  }
  updateGuildWelcomeScreen(guildId: string, data: {
    enabled: boolean;
    description: string | null;
    welcome_channels: Array<{
      channel_id: string;
      description: string;
      emoji_name: string | null;
    }>;
  }) {
    return this.request<unknown>('PATCH', `/guilds/${guildId}/welcome-screen`, data);
  }

  // Onboarding
  getGuildOnboarding(guildId: string) {
    return this.request<unknown>('GET', `/guilds/${guildId}/onboarding`);
  }
  updateGuildOnboarding(guildId: string, data: {
    enabled: boolean;
    default_channel_ids: string[];
    prompts: Array<{
      title: string;
      options: Array<{ title: string; description: string | null; channel_ids: string[] }>;
    }>;
  }) {
    return this.request<unknown>('PUT', `/guilds/${guildId}/onboarding`, data);
  }
}

export const api = new ApiClient();
