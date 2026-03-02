// Common types for the application
export interface User {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  role: UserRole;
  is_active?: boolean | number;
  created_at: string;
  updated_at: string;
}

export interface Site {
  id: number;
  name: string;
  code: string;
  created_by: number;
  location?: string;
  description?: string;
  is_active?: boolean | number;
  created_at: string;
  updated_at: string;
}

export interface SiteLocation {
  id: number;
  site_id: number;
  template_type?: 'DATACENTRE' | 'DOMESTIC';
  floor: string;
  suite?: string | null;
  row?: string | null;
  rack?: string | null;
  rack_size_u?: number | null;
  area?: string | null;
  label?: string | null;
  effective_label?: string;
  created_at: string;
  updated_at: string;
}

export interface CableType {
  id: number;
  site_id: number;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Label {
  id: number;
  site_id: number;
  created_by: number;
  created_by_name?: string | null;
  created_by_email?: string | null;
  ref_number: number;
  ref_string: string;
  cable_type_id?: number | null;
  cable_type?: CableType | null;
  type: string;
  payload_json: string | null;
  source_location_id?: number | null;
  destination_location_id?: number | null;
  source_location?: SiteLocation | null;
  destination_location?: SiteLocation | null;
  created_at: string;
  updated_at: string;
  // Legacy API compatibility fields
  reference_number?: string;
  source?: string;
  destination?: string;
  notes?: string;
  zpl_content?: string;
  via_patch_panel?: boolean;
  patch_panel_sid_id?: number | null;
  patch_panel_port?: number | null;
}

export interface SiteMembership {
  id: number;
  site_id: number;
  user_id: number;
  site_role: SiteRole;
}

export type UserRole = 'GLOBAL_ADMIN' | 'USER';
export type SiteRole = 'SITE_ADMIN' | 'SITE_USER';

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}