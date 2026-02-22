import { toast } from 'sonner';
import { ApiResponse, AuthTokens } from '../types';

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  response?: unknown;

  constructor(message: string, params: { status: number; code?: string; details?: unknown; response?: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
    this.response = params.response;
  }
}

// In production (Docker), frontend is served from same origin, so use relative path
// In development, use explicit localhost URL or VITE_API_URL override
const isProd = (import.meta as any).env?.MODE === 'production';
const envApiUrl = (import.meta as any).env?.VITE_API_URL;
const API_BASE_URL = isProd ? '/api' : (envApiUrl || 'http://localhost:3001/api');

// Log resolved API base URL for troubleshooting
console.info(`[API] Base URL: ${API_BASE_URL} (mode: ${(import.meta as any).env?.MODE || 'unknown'})`);

// Token management
let authTokens: AuthTokens | null = null;

export const setAuthTokens = (tokens: AuthTokens | null) => {
  authTokens = tokens;
  if (tokens) {
    localStorage.setItem('auth_tokens', JSON.stringify(tokens));
  } else {
    localStorage.removeItem('auth_tokens');
  }
};

export const getAuthTokens = (): AuthTokens | null => {
  if (authTokens) return authTokens;
  
  const stored = localStorage.getItem('auth_tokens');
  if (stored) {
    try {
      authTokens = JSON.parse(stored);
      return authTokens;
    } catch {
      localStorage.removeItem('auth_tokens');
    }
  }
  return null;
};

export const clearAuthTokens = () => {
  authTokens = null;
  localStorage.removeItem('auth_tokens');
};

// API client class
class ApiClient {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseURL}${endpoint}`;
    const tokens = getAuthTokens();

    // Debug logging for API requests in development
    if ((import.meta as any).env?.MODE === 'development') {
      console.log(`[API] ${options.method || 'GET'} ${url}`);
    }

    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    // Add authorization header if tokens exist
    if (tokens?.accessToken) {
      (config.headers as Record<string, string>)['Authorization'] = 
        `Bearer ${tokens.accessToken}`;
    }

    try {
      const response = await fetch(url, config);
      
      // Handle network errors
      if (!response.ok && response.status >= 500) {
        const errorMessage = 'Server error. Please try again later.';
        toast.error(errorMessage);
        throw new ApiError(errorMessage, { status: response.status });
      }

      const data = await response.json();

      // Handle token refresh for 401 errors
      if (response.status === 401 && tokens?.refreshToken && endpoint !== '/auth/refresh') {
        try {
          const refreshResponse = await this.refreshToken(tokens.refreshToken);
          if (refreshResponse.success && refreshResponse.data) {
            setAuthTokens(refreshResponse.data);
            
            // Retry original request with new token
            (config.headers as Record<string, string>)['Authorization'] = 
              `Bearer ${refreshResponse.data.accessToken}`;
            
            const retryResponse = await fetch(url, config);
            const retryData = await retryResponse.json();
            
            if (!retryResponse.ok) {
              throw new Error(retryData.error || `HTTP error! status: ${retryResponse.status}`);
            }
            
            return retryData;
          }
        } catch (refreshError) {
          // Refresh failed, clear tokens
          clearAuthTokens();
          const errorMessage = 'Session expired. Please login again.';
          toast.error(errorMessage);
          throw new Error(errorMessage);
        }
      }

      if (!response.ok) {
        const errorCode = typeof data?.error === 'string' ? data.error : undefined;
        const errorMessage = errorCode || `HTTP error! status: ${response.status}`;
        
        // Don't show toast for auth errors (handled by forms)
        if (response.status !== 401 && response.status !== 403) {
          toast.error(errorMessage);
        }

        throw new ApiError(errorMessage, {
          status: response.status,
          code: errorCode,
          details: (data as any)?.details,
          response: data,
        });
      }

      return data;
    } catch (error) {
      // Log detailed error info for debugging
      console.error(`[API Error] ${options.method || 'GET'} ${url}:`, error);
      
      // Handle network connectivity issues
      if (error instanceof TypeError) {
        if (error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
          const networkError = 'Network error. Check connection.';
          toast.error(networkError);
          throw new ApiError(networkError, { status: 0 });
        }
      }
      
      if (error instanceof Error) {
        throw error;
      }
      
      const unknownError = 'An unexpected error occurred';
      toast.error(unknownError);
      throw new Error(unknownError);
    }
  }

  // Auth endpoints
  async login(email: string, password: string) {
    console.log(`[Auth] Attempting login for: ${email}`);
    try {
      const response = await this.request<{ user: any } & AuthTokens>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      console.log(`[Auth] Login successful for: ${email}`);
      return response;
    } catch (error) {
      console.error(`[Auth] Login failed for ${email}:`, error);
      throw error;
    }
  }

  async register(email: string, username: string, password: string) {
    console.log(`[Auth] Attempting registration for: ${email}`);
    try {
      const response = await this.request<{ user: any } & AuthTokens>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, username, password }),
      });
      console.log(`[Auth] Registration successful for: ${email}`);
      return response;
    } catch (error) {
      console.error(`[Auth] Registration failed for ${email}:`, error);
      throw error;
    }
  }

  async refreshToken(refreshToken: string) {
    return this.request<AuthTokens>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  }

  async getCurrentUser() {
    return this.request<{ user: any; memberships?: any[] }>('/auth/me');
  }

  async logout() {
    return this.request('/auth/logout', {
      method: 'POST',
    });
  }

  async updateProfile(data: { email?: string }) {
    return this.request<{ user: any }>('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async changePassword(data: { current_password: string; new_password: string }) {
    return this.request('/auth/password', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async resetPassword(data: { token: string; password: string }) {
    return this.request('/auth/password-reset', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Site endpoints
  async getSites(params?: { search?: string; limit?: number; offset?: number; include_counts?: boolean }) {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.append('search', params.search);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());
    if (params?.include_counts) searchParams.append('include_counts', params.include_counts.toString());
    
    const query = searchParams.toString();
    return this.request<{ sites: any[]; pagination: any }>(`/sites${query ? `?${query}` : ''}`);
  }

  async getSite(id: number) {
    return this.request<{ site: any }>(`/sites/${id}`);
  }

  async createSite(data: { name: string; code: string; location?: string; description?: string }) {
    return this.request<{ site: any }>('/sites', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSite(id: number, data: { name?: string; code?: string; location?: string; description?: string }) {
    return this.request<{ site: any }>(`/sites/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSite(id: number, options?: { cascade?: boolean }) {
    const query = options?.cascade ? '?cascade=true' : '';
    return this.request(`/sites/${id}${query}`, { method: 'DELETE' });
  }

  // Site Locations endpoints
  async getSiteLocations(siteId: number) {
    return this.request<{ locations: any[] }>(`/sites/${siteId}/locations`);
  }

  async createSiteLocation(siteId: number, data: {
    template_type?: 'DATACENTRE' | 'DOMESTIC';
    floor?: string;
    suite?: string;
    row?: string;
    rack?: string;
    area?: string;
    label?: string;
  }) {
    return this.request<{ location: any }>(`/sites/${siteId}/locations`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSiteLocation(
    siteId: number,
    locationId: number,
    data: {
      template_type?: 'DATACENTRE' | 'DOMESTIC';
      floor?: string | null;
      suite?: string | null;
      row?: string | null;
      rack?: string | null;
      area?: string | null;
      label?: string | null;
    }
  ) {
    return this.request<{ location: any }>(`/sites/${siteId}/locations/${locationId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSiteLocation(
    siteId: number,
    locationId: number,
    options?: { strategy?: 'reassign' | 'cascade'; target_location_id?: number; cascade?: boolean }
  ) {
    const params = new URLSearchParams();
    // Prefer the explicit cascade=true query flag for cascade deletes.
    // Keep supporting strategy=cascade for backwards compatibility.
    if (options?.cascade || options?.strategy === 'cascade') params.set('cascade', 'true');
    else if (options?.strategy) params.set('strategy', options.strategy);
    if (options?.target_location_id) params.set('target_location_id', String(options.target_location_id));
    const query = params.toString();
    return this.request(`/sites/${siteId}/locations/${locationId}${query ? `?${query}` : ''}`, { method: 'DELETE' });
  }

  async getSiteLocationUsage(siteId: number, locationId: number) {
    return this.request<{ usage: { source_count: number; destination_count: number; total_in_use: number } }>(
      `/sites/${siteId}/locations/${locationId}/usage`
    );
  }

  async reassignAndDeleteSiteLocation(siteId: number, locationId: number, reassignToLocationId: number) {
    return this.request<{ reassigned_count: number; deleted_location_id: number; usage_before: any }>(
      `/sites/${siteId}/locations/${locationId}/reassign-and-delete`,
      {
        method: 'POST',
        body: JSON.stringify({ reassign_to_location_id: reassignToLocationId }),
      }
    );
  }

  // Cable Types endpoints
  async getSiteCableTypes(siteId: number) {
    return this.request<{ cable_types: any[] }>(`/sites/${siteId}/cable-types`);
  }

  async createSiteCableType(siteId: number, data: { name: string; description?: string }) {
    return this.request<{ cable_type: any }>(`/sites/${siteId}/cable-types`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSiteCableType(siteId: number, cableTypeId: number, data: { name?: string; description?: string | null }) {
    return this.request<{ cable_type: any }>(`/sites/${siteId}/cable-types/${cableTypeId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getSiteCableTypeUsage(siteId: number, cableTypeId: number) {
    return this.request<{ usage: { cables_using_type: number } }>(`/sites/${siteId}/cable-types/${cableTypeId}/usage`);
  }

  async deleteSiteCableType(siteId: number, cableTypeId: number) {
    return this.request(`/sites/${siteId}/cable-types/${cableTypeId}`, { method: 'DELETE' });
  }

  // SID Index endpoints
  async getSiteSids(
    siteId: number,
    params?: {
      search?: string;
      search_field?: 'any' | 'status' | 'sid' | 'location' | 'hostname' | 'model';
      exact?: boolean;
      show_deleted?: boolean;
      limit?: number;
      offset?: number;
    }
  ) {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.append('search', params.search);
    if (params?.search_field) searchParams.append('search_field', params.search_field);
    if (params?.exact) searchParams.append('exact', '1');
    if (params?.show_deleted) searchParams.append('show_deleted', '1');
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());
    const query = searchParams.toString();
    return this.request<{ sids: any[]; pagination: any }>(`/sites/${siteId}/sids${query ? `?${query}` : ''}`);
  }

  async createSiteSid(siteId: number, data: {
    sid_type_id?: number | null;
    device_model_id?: number | null;
    cpu_model_id?: number | null;
    hostname?: string | null;
    serial_number?: string | null;
    status?: string | null;
    cpu_count?: number | null;
    cpu_cores?: number | null;
    cpu_threads?: number | null;
    ram_gb?: number | null;
    platform_id?: number | null;
    os_name?: string | null;
    os_version?: string | null;
    mgmt_ip?: string | null;
    mgmt_mac?: string | null;
    location_id?: number | null;
    rack_u?: string | null;
  }) {
    return this.request<{ sid: any }>(`/sites/${siteId}/sids`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getSiteSid(siteId: number, sidId: number, opts?: { log_view?: boolean }) {
    const searchParams = new URLSearchParams();
    if (opts?.log_view === false) searchParams.append('log_view', '0');
    const query = searchParams.toString();
    return this.request<{ sid: any; notes: any[]; nics: any[] }>(`/sites/${siteId}/sids/${sidId}${query ? `?${query}` : ''}`);
  }

  async getSiteSidHistory(siteId: number, sidId: number) {
    return this.request<{ history: any[] }>(`/sites/${siteId}/sids/${sidId}/history`);
  }

  async getSiteSidPassword(siteId: number, sidId: number) {
    return this.request<{ password: any }>(`/sites/${siteId}/sids/${sidId}/password`);
  }

  async getSiteSidPasswords(siteId: number, sidId: number) {
    return this.request<{ passwords: any[]; key_configured: boolean }>(`/sites/${siteId}/sids/${sidId}/passwords`);
  }

  async createSiteSidTypedPassword(
    siteId: number,
    sidId: number,
    data: { password_type_id: number; username: string; password: string }
  ) {
    return this.request<{ created: boolean }>(`/sites/${siteId}/sids/${sidId}/passwords`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSiteSidPassword(
    siteId: number,
    sidId: number,
    data: { username?: string | null; password?: string | null }
  ) {
    return this.request<{ updated: boolean }>(`/sites/${siteId}/sids/${sidId}/password`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updateSiteSidPasswordByType(
    siteId: number,
    sidId: number,
    passwordTypeId: number,
    data: { username?: string | null; password?: string | null }
  ) {
    return this.request<{ updated: boolean }>(`/sites/${siteId}/sids/${sidId}/passwords/${passwordTypeId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getSiteSidPasswordTypes(siteId: number) {
    return this.request<{ password_types: any[] }>(`/sites/${siteId}/sid/password-types`);
  }

  async getSiteSidPasswordTypeUsage(siteId: number, rowId: number) {
    return this.request<{ sids_using: number }>(`/sites/${siteId}/sid/password-types/${rowId}/usage`);
  }

  async createSiteSidPasswordType(siteId: number, data: { name: string; description?: string | null }) {
    return this.request<{ password_type: any }>(`/sites/${siteId}/sid/password-types`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSiteSidPasswordType(siteId: number, rowId: number, data: { name?: string; description?: string | null }) {
    return this.request<{ password_type: any }>(`/sites/${siteId}/sid/password-types/${rowId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSiteSidPasswordType(siteId: number, rowId: number) {
    return this.request<{ deleted: boolean }>(`/sites/${siteId}/sid/password-types/${rowId}`, { method: 'DELETE' });
  }

  async updateSiteSid(siteId: number, sidId: number, data: Record<string, any>) {
    return this.request<{ sid: any }>(`/sites/${siteId}/sids/${sidId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSiteSid(siteId: number, sidId: number) {
    return this.request<{ deleted: boolean }>(`/sites/${siteId}/sids/${sidId}`, {
      method: 'DELETE',
    });
  }

  async addSiteSidNote(siteId: number, sidId: number, data: { note_text: string; type?: 'NOTE' | 'CLOSING' }) {
    return this.request<{ note: any }>(`/sites/${siteId}/sids/${sidId}/notes`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async setSiteSidNotePinned(siteId: number, sidId: number, noteId: number, pinned: boolean) {
    return this.request<{ note: any }>(`/sites/${siteId}/sids/${sidId}/notes/${noteId}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    });
  }

  async replaceSiteSidNics(
    siteId: number,
    sidId: number,
    data: {
      nics: Array<{
        card_name?: string | null;
        name: string;
        mac_address?: string | null;
        ip_address?: string | null;
        site_vlan_id?: number | null;
        nic_type_id?: number | null;
        nic_speed_id?: number | null;
        switch_sid_id?: number | null;
        switch_port?: string | null;
      }>;
    }
  ) {
    return this.request<{ nics: any[] }>(`/sites/${siteId}/sids/${sidId}/nics`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getSiteSidIpAddresses(siteId: number, sidId: number) {
    return this.request<{ ip_addresses: string[] }>(`/sites/${siteId}/sids/${sidId}/ip-addresses`);
  }

  async replaceSiteSidIpAddresses(siteId: number, sidId: number, data: { ip_addresses: string[] }) {
    return this.request<{ ip_addresses: string[] }>(`/sites/${siteId}/sids/${sidId}/ip-addresses`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getSiteSidNicTypes(siteId: number) {
    return this.request<{ nic_types: any[] }>(`/sites/${siteId}/sid/nic-types`);
  }

  async getSiteSidNicTypeUsage(siteId: number, rowId: number) {
    return this.request<{ sids_using: number }>(`/sites/${siteId}/sid/nic-types/${rowId}/usage`);
  }

  async createSiteSidNicType(siteId: number, data: { name: string; description?: string | null }) {
    return this.request<{ nic_type: any }>(`/sites/${siteId}/sid/nic-types`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSiteSidNicType(siteId: number, rowId: number, data: { name?: string; description?: string | null }) {
    return this.request<{ nic_type: any }>(`/sites/${siteId}/sid/nic-types/${rowId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSiteSidNicType(siteId: number, rowId: number) {
    return this.request<{ deleted: boolean }>(`/sites/${siteId}/sid/nic-types/${rowId}`, { method: 'DELETE' });
  }

  async getSiteSidNicSpeeds(siteId: number) {
    return this.request<{ nic_speeds: any[] }>(`/sites/${siteId}/sid/nic-speeds`);
  }

  async getSiteSidNicSpeedUsage(siteId: number, rowId: number) {
    return this.request<{ sids_using: number }>(`/sites/${siteId}/sid/nic-speeds/${rowId}/usage`);
  }

  async createSiteSidNicSpeed(siteId: number, data: { name: string; description?: string | null }) {
    return this.request<{ nic_speed: any }>(`/sites/${siteId}/sid/nic-speeds`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSiteSidNicSpeed(siteId: number, rowId: number, data: { name?: string; description?: string | null }) {
    return this.request<{ nic_speed: any }>(`/sites/${siteId}/sid/nic-speeds/${rowId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSiteSidNicSpeed(siteId: number, rowId: number) {
    return this.request<{ deleted: boolean }>(`/sites/${siteId}/sid/nic-speeds/${rowId}`, { method: 'DELETE' });
  }

  async getSiteSidTypes(siteId: number) {
    return this.request<{ sid_types: any[] }>(`/sites/${siteId}/sid/types`);
  }

  async getSiteSidTypeUsage(siteId: number, rowId: number) {
    return this.request<{ sids_using: number }>(`/sites/${siteId}/sid/types/${rowId}/usage`);
  }

  async createSiteSidType(siteId: number, data: { name: string; description?: string | null }) {
    return this.request<{ sid_type: any }>(`/sites/${siteId}/sid/types`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSiteSidType(siteId: number, rowId: number, data: { name?: string; description?: string | null }) {
    return this.request<{ sid_type: any }>(`/sites/${siteId}/sid/types/${rowId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSiteSidType(siteId: number, rowId: number) {
    return this.request<{ deleted: boolean }>(`/sites/${siteId}/sid/types/${rowId}`, { method: 'DELETE' });
  }

  async getSiteSidDeviceModels(siteId: number) {
    return this.request<{ device_models: any[] }>(`/sites/${siteId}/sid/device-models`);
  }

  async getSiteSidDeviceModelUsage(siteId: number, rowId: number) {
    return this.request<{ sids_using: number }>(`/sites/${siteId}/sid/device-models/${rowId}/usage`);
  }

  async createSiteSidDeviceModel(siteId: number, data: { manufacturer?: string | null; name: string; description?: string | null }) {
    return this.request<{ device_model: any }>(`/sites/${siteId}/sid/device-models`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSiteSidDeviceModel(
    siteId: number,
    rowId: number,
    data: { manufacturer?: string | null; name?: string; description?: string | null }
  ) {
    return this.request<{ device_model: any }>(`/sites/${siteId}/sid/device-models/${rowId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSiteSidDeviceModel(siteId: number, rowId: number) {
    return this.request<{ deleted: boolean }>(`/sites/${siteId}/sid/device-models/${rowId}`, { method: 'DELETE' });
  }

  async getSiteSidCpuModels(siteId: number) {
    return this.request<{ cpu_models: any[] }>(`/sites/${siteId}/sid/cpu-models`);
  }

  async getSiteSidCpuModelUsage(siteId: number, rowId: number) {
    return this.request<{ sids_using: number }>(`/sites/${siteId}/sid/cpu-models/${rowId}/usage`);
  }

  async getSiteSidPlatforms(siteId: number) {
    return this.request<{ platforms: any[] }>(`/sites/${siteId}/sid/platforms`);
  }

  async getSiteSidPlatformUsage(siteId: number, rowId: number) {
    return this.request<{ sids_using: number }>(`/sites/${siteId}/sid/platforms/${rowId}/usage`);
  }

  async getSiteSidStatuses(siteId: number) {
    return this.request<{ statuses: any[] }>(`/sites/${siteId}/sid/statuses`);
  }

  async getSiteSidStatusUsage(siteId: number, rowId: number) {
    return this.request<{ sids_using: number }>(`/sites/${siteId}/sid/statuses/${rowId}/usage`);
  }

  async createSiteSidStatus(siteId: number, data: { name: string; description?: string | null }) {
    return this.request<{ status: any }>(`/sites/${siteId}/sid/statuses`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSiteSidStatus(siteId: number, rowId: number, data: { name?: string; description?: string | null }) {
    return this.request<{ status: any }>(`/sites/${siteId}/sid/statuses/${rowId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSiteSidStatus(siteId: number, rowId: number) {
    return this.request<{ deleted: boolean }>(`/sites/${siteId}/sid/statuses/${rowId}`, { method: 'DELETE' });
  }

  async createSiteSidPlatform(siteId: number, data: { name: string; description?: string | null }) {
    return this.request<{ platform: any }>(`/sites/${siteId}/sid/platforms`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSiteSidPlatform(siteId: number, rowId: number, data: { name?: string; description?: string | null }) {
    return this.request<{ platform: any }>(`/sites/${siteId}/sid/platforms/${rowId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSiteSidPlatform(siteId: number, rowId: number) {
    return this.request<{ deleted: boolean }>(`/sites/${siteId}/sid/platforms/${rowId}`, { method: 'DELETE' });
  }

  async createSiteSidCpuModel(
    siteId: number,
    data: { manufacturer?: string | null; name: string; cpu_cores: number; cpu_threads: number; description?: string | null }
  ) {
    return this.request<{ cpu_model: any }>(`/sites/${siteId}/sid/cpu-models`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSiteSidCpuModel(
    siteId: number,
    rowId: number,
    data: { manufacturer?: string | null; name?: string; cpu_cores?: number; cpu_threads?: number; description?: string | null }
  ) {
    return this.request<{ cpu_model: any }>(`/sites/${siteId}/sid/cpu-models/${rowId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSiteSidCpuModel(siteId: number, rowId: number) {
    return this.request<{ deleted: boolean }>(`/sites/${siteId}/sid/cpu-models/${rowId}`, { method: 'DELETE' });
  }

  async getSiteSidVlans(siteId: number) {
    return this.request<{ vlans: any[] }>(`/sites/${siteId}/sid/vlans`);
  }

  async getSiteSidVlanUsage(siteId: number, rowId: number) {
    return this.request<{ sids_using: number }>(`/sites/${siteId}/sid/vlans/${rowId}/usage`);
  }

  async createSiteSidVlan(siteId: number, data: { vlan_id: number; name: string; description?: string | null }) {
    return this.request<{ vlan: any }>(`/sites/${siteId}/sid/vlans`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSiteSidVlan(siteId: number, rowId: number, data: { vlan_id?: number; name?: string; description?: string | null }) {
    return this.request<{ vlan: any }>(`/sites/${siteId}/sid/vlans/${rowId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSiteSidVlan(siteId: number, rowId: number) {
    return this.request<{ deleted: boolean }>(`/sites/${siteId}/sid/vlans/${rowId}`, { method: 'DELETE' });
  }

  // Label endpoints
  async getLabels(params: {
    site_id: number;
    search?: string;
    reference_number?: string;
    source_location_id?: number;
    destination_location_id?: number;
    source_location_label?: string;
    source_floor?: string;
    source_suite?: string;
    source_row?: string;
    source_rack?: string;
    source_area?: string;
    destination_location_label?: string;
    destination_floor?: string;
    destination_suite?: string;
    destination_row?: string;
    destination_rack?: string;
    destination_area?: string;
    cable_type_id?: number;
    created_by?: string;
    limit?: number;
    offset?: number;
    sort_by?: 'created_at' | 'ref_string';
    sort_order?: 'ASC' | 'DESC';
  }) {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.append('search', params.search);
    if (params?.site_id) searchParams.append('site_id', params.site_id.toString());
    if (params?.reference_number) searchParams.append('reference_number', params.reference_number);
    if (Number.isFinite(params?.source_location_id) && (params!.source_location_id as number) > 0) {
      searchParams.append('source_location_id', String(params!.source_location_id));
    }
    if (Number.isFinite(params?.destination_location_id) && (params!.destination_location_id as number) > 0) {
      searchParams.append('destination_location_id', String(params!.destination_location_id));
    }

    if (params?.source_location_label) searchParams.append('source_location_label', params.source_location_label);
    if (params?.source_floor) searchParams.append('source_floor', params.source_floor);
    if (params?.source_suite) searchParams.append('source_suite', params.source_suite);
    if (params?.source_row) searchParams.append('source_row', params.source_row);
    if (params?.source_rack) searchParams.append('source_rack', params.source_rack);
    if (params?.source_area) searchParams.append('source_area', params.source_area);

    if (params?.destination_location_label) searchParams.append('destination_location_label', params.destination_location_label);
    if (params?.destination_floor) searchParams.append('destination_floor', params.destination_floor);
    if (params?.destination_suite) searchParams.append('destination_suite', params.destination_suite);
    if (params?.destination_row) searchParams.append('destination_row', params.destination_row);
    if (params?.destination_rack) searchParams.append('destination_rack', params.destination_rack);
    if (params?.destination_area) searchParams.append('destination_area', params.destination_area);

    if (Number.isFinite(params?.cable_type_id) && (params!.cable_type_id as number) > 0) {
      searchParams.append('cable_type_id', String(params!.cable_type_id));
    }
    if (params?.created_by) searchParams.append('created_by', params.created_by);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());
    if (params?.sort_by) searchParams.append('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.append('sort_order', params.sort_order);
    
    const query = searchParams.toString();
    return this.request<{ labels: any[]; pagination: any }>(`/labels${query ? `?${query}` : ''}`);
  }

  async getLabel(id: number, siteId: number) {
    return this.request<{ label: any }>(`/labels/${id}?site_id=${siteId}`);
  }

  async createLabel(data: { source_location_id: number; destination_location_id: number; cable_type_id: number; site_id: number; quantity?: number; notes?: string; zpl_content?: string }) {
    return this.request<{ label: any; labels?: any[] }>('/labels', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateLabel(
    id: number,
    data: { site_id: number; source_location_id?: number; destination_location_id?: number; cable_type_id?: number; notes?: string; zpl_content?: string }
  ) {
    return this.request<{ label: any }>(`/labels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteLabel(id: number, siteId: number) {
    return this.request(`/labels/${id}?site_id=${siteId}`, { method: 'DELETE' });
  }

  async bulkDeleteLabels(siteId: number, ids: number[]) {
    return this.request<{ deleted_count: number }>('/labels/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ site_id: siteId, ids }),
    });
  }

  async getLabelStats(siteId: number) {
    return this.request<{ stats: any }>(`/labels/stats?site_id=${siteId}`);
  }

  async getRecentLabels(siteId: number, limit?: number) {
    const searchParams = new URLSearchParams();
    searchParams.append('site_id', siteId.toString());
    if (limit) searchParams.append('limit', limit.toString());
    
    const query = searchParams.toString();
    return this.request<{ labels: any[] }>(`/labels/recent${query ? `?${query}` : ''}`);
  }

  // Admin endpoints
  async getUsers(params?: { search?: string; role?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.append('search', params.search);
    if (params?.role) searchParams.append('role', params.role);
    
    const query = searchParams.toString();
    return this.request<{ users: any[] }>(`/admin/users${query ? `?${query}` : ''}`);
  }

  async updateUserRole(userId: number, role: 'GLOBAL_ADMIN' | 'USER') {
    return this.request(`/admin/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
  }

  async deleteUser(userId: number, options?: { cascade?: boolean }) {
    const query = options?.cascade ? '?cascade=true' : '';
    return this.request(`/admin/users/${userId}${query}`, { method: 'DELETE' });
  }

  async inviteUser(
    email: string,
    sites: Array<{ site_id: number; site_role: 'SITE_ADMIN' | 'SITE_USER' }>,
    username: string,
    expires_in_days?: number
  ) {
    return this.request('/admin/invite', {
      method: 'POST',
      body: JSON.stringify({ email, username, sites, ...(expires_in_days ? { expires_in_days } : {}) }),
    });
  }

  async getUserSites(userId: number) {
    return this.request<{ sites: any[] }>(`/admin/users/${userId}/sites`);
  }

  async updateUserSites(userId: number, sites: Array<{ site_id: number; site_role: 'SITE_ADMIN' | 'SITE_USER' }>) {
    return this.request(`/admin/users/${userId}/sites`, {
      method: 'PUT',
      body: JSON.stringify({ sites }),
    });
  }

  async getInvitations() {
    return this.request<any[]>('/admin/invitations');
  }

  async cancelInvitation(invitationId: number) {
    return this.request(`/admin/invitations/${invitationId}`, { method: 'DELETE' });
  }

  async rotateInvitationLink(invitationId: number, params?: { expires_in_days?: number }) {
    return this.request<{ invite_url: string; expires_at: string }>(`/admin/invitations/${invitationId}/link`, {
      method: 'POST',
      body: JSON.stringify({ ...(params?.expires_in_days ? { expires_in_days: params.expires_in_days } : {}) }),
    });
  }

  async resendInvitation(invitationId: number, params?: { expires_in_days?: number }) {
    return this.request<{ invite_url: string; expires_at: string; email_sent: boolean; email_error?: string }>(
      `/admin/invitations/${invitationId}/resend`,
      {
        method: 'POST',
        body: JSON.stringify({ ...(params?.expires_in_days ? { expires_in_days: params.expires_in_days } : {}) }),
      }
    );
  }

  async getAdminStats(siteId: number) {
    return this.request<any>(`/admin/stats?site_id=${siteId}`);
  }

  async validateInvite(token: string) {
    return this.request<any>(`/admin/validate-invite/${token}`);
  }

  async acceptInvite(data: { token: string; password: string }) {
    return this.request<any>('/admin/accept-invite', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getAppSettings() {
    return this.request<{ settings: any }>('/admin/settings');
  }

  async updateAppSettings(settings: any) {
    return this.request('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // Generic methods for other endpoints
  async get<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data: any) {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async put<T>(endpoint: string, data: any) {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async delete<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  // Special method for downloading files as blobs
  async downloadFile(endpoint: string, data: any): Promise<Blob> {
    const url = `${this.baseURL}${endpoint}`;
    const tokens = getAuthTokens();

    const config: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    };

    // Add authorization header if tokens exist
    if (tokens?.accessToken) {
      (config.headers as Record<string, string>)['Authorization'] = 
        `Bearer ${tokens.accessToken}`;
    }

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      return await response.blob();
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Network error occurred');
    }
  }

  // Special method for downloading GET files as blobs
  async downloadGetFile(endpoint: string): Promise<Blob> {
    const url = `${this.baseURL}${endpoint}`;
    const tokens = getAuthTokens();

    const config: RequestInit = {
      method: 'GET',
      headers: {},
    };

    if (tokens?.accessToken) {
      (config.headers as Record<string, string>)['Authorization'] = `Bearer ${tokens.accessToken}`;
    }

    const response = await fetch(url, config);
    if (!response.ok) {
      let message = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();
        message = errorData.error || message;
      } catch {
        // ignore
      }
      throw new Error(message);
    }

    return await response.blob();
  }

  async downloadGetFileWithName(endpoint: string): Promise<{ blob: Blob; filename?: string }> {
    const url = `${this.baseURL}${endpoint}`;
    const tokens = getAuthTokens();

    const config: RequestInit = {
      method: 'GET',
      headers: {},
    };

    if (tokens?.accessToken) {
      (config.headers as Record<string, string>)['Authorization'] = `Bearer ${tokens.accessToken}`;
    }

    const response = await fetch(url, config);
    if (!response.ok) {
      let message = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();
        message = errorData.error || message;
      } catch {
        // ignore
      }
      throw new Error(message);
    }

    const disposition = response.headers.get('Content-Disposition') || response.headers.get('content-disposition');
    let filename: string | undefined;
    if (disposition) {
      const match = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
      if (match?.[1]) filename = match[1];
    }

    const blob = await response.blob();
    return { blob, filename };
  }

  async downloadSiteCableReport(siteId: number): Promise<{ blob: Blob; filename?: string }> {
    return this.downloadGetFileWithName(`/sites/${siteId}/cable-report`);
  }

  async downloadLabelZpl(labelId: number, siteId: number): Promise<Blob> {
    return this.downloadGetFile(`/labels/${labelId}/zpl?site_id=${siteId}`);
  }
}

// Export singleton instance
export const apiClient = new ApiClient(API_BASE_URL);
export default apiClient;