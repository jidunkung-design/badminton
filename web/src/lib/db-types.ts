export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      session_courts: {
        Row: { session_id: string; court_no: number; starts_at: string | null; ends_at: string | null; retained_pair: string[] | null; retained_match_id: string | null }
        Insert: { session_id: string; court_no: number; starts_at?: string | null; ends_at?: string | null; retained_pair?: string[] | null; retained_match_id?: string | null }
        Update: { session_id?: string; court_no?: number; starts_at?: string | null; ends_at?: string | null; retained_pair?: string[] | null; retained_match_id?: string | null }
        Relationships: [{ foreignKeyName: "session_courts_session_id_fkey"; columns: ["session_id"]; isOneToOne: false; referencedRelation: "sessions"; referencedColumns: ["id"] }]
      }
      active_court_matches: {
        Row: { session_id: string; court_no: number; client_id: string; group_id: string; team_a: string[]; team_b: string[]; mode: Database["public"]["Enums"]["queue_mode"]; balance_weight: number; started_at: string; rotation_mode: string }
        Insert: { session_id: string; court_no: number; client_id: string; group_id: string; team_a: string[]; team_b: string[]; mode: Database["public"]["Enums"]["queue_mode"]; balance_weight: number; started_at?: string; rotation_mode?: string }
        Update: { session_id?: string; court_no?: number; client_id?: string; group_id?: string; team_a?: string[]; team_b?: string[]; mode?: Database["public"]["Enums"]["queue_mode"]; balance_weight?: number; started_at?: string; rotation_mode?: string }
        Relationships: [
          { foreignKeyName: "active_court_matches_group_id_fkey"; columns: ["group_id"]; isOneToOne: false; referencedRelation: "groups"; referencedColumns: ["id"] },
          { foreignKeyName: "active_court_matches_session_id_court_no_fkey"; columns: ["session_id", "court_no"]; isOneToOne: true; referencedRelation: "session_courts"; referencedColumns: ["session_id", "court_no"] },
        ]
      }
      attendance: {
        Row: {
          player_id: string
          session_id: string
        }
        Insert: {
          player_id: string
          session_id: string
        }
        Update: {
          player_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string
          joined_at: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          group_id: string
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          group_id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          room_slot: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          room_slot?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          room_slot?: number
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_players: {
        Row: {
          match_id: string
          player_id: string
          team: number
        }
        Insert: {
          match_id: string
          player_id: string
          team: number
        }
        Update: {
          match_id?: string
          player_id?: string
          team?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_players_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          balance_weight: number
          client_id: string
          court_no: number
          ended_at: string | null
          group_id: string
          id: string
          rotation_mode: string
          play_started_at: string | null
          play_ended_at: string | null
          mode: Database["public"]["Enums"]["queue_mode"]
          session_id: string
          streak_roster: string[] | null
          started_at: string
          winner_team: number | null
        }
        Insert: {
          balance_weight?: number
          client_id: string
          court_no: number
          ended_at?: string | null
          group_id: string
          id?: string
          rotation_mode?: string
          play_started_at?: string | null
          play_ended_at?: string | null
          mode: Database["public"]["Enums"]["queue_mode"]
          session_id: string
          streak_roster?: string[] | null
          started_at?: string
          winner_team?: number | null
        }
        Update: {
          balance_weight?: number
          client_id?: string
          court_no?: number
          ended_at?: string | null
          group_id?: string
          id?: string
          rotation_mode?: string
          play_started_at?: string | null
          play_ended_at?: string | null
          mode?: Database["public"]["Enums"]["queue_mode"]
          session_id?: string
          streak_roster?: string[] | null
          started_at?: string
          winner_team?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          gender: string
          archived_at: string | null
          created_at: string
          group_id: string
          id: string
          last_seen_on: string | null
          name: string
          skill: number
          user_id: string | null
        }
        Insert: {
          gender?: string
          archived_at?: string | null
          created_at?: string
          group_id: string
          id?: string
          last_seen_on?: string | null
          name: string
          skill?: number
          user_id?: string | null
        }
        Update: {
          gender?: string
          archived_at?: string | null
          created_at?: string
          group_id?: string
          id?: string
          last_seen_on?: string | null
          name?: string
          skill?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          gender: string
          created_at: string
          display_name: string
          id: string
          is_super_admin: boolean
          username: string | null
        }
        Insert: {
          gender?: string
          created_at?: string
          display_name?: string
          id: string
          is_super_admin?: boolean
          username?: string | null
        }
        Update: {
          gender?: string
          created_at?: string
          display_name?: string
          id?: string
          is_super_admin?: boolean
          username?: string | null
        }
        Relationships: []
      }
      room_join_requests: {
        Row: { group_id: string; user_id: string; username: string; created_at: string; pin_verified: boolean }
        Insert: { group_id: string; user_id: string; username: string; created_at?: string; pin_verified?: boolean }
        Update: { group_id?: string; user_id?: string; username?: string; created_at?: string; pin_verified?: boolean }
        Relationships: [
          {
            foreignKeyName: "room_join_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_join_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          ended_at: string | null
          group_id: string
          id: string
          name: string
          started_at: string
        }
        Insert: {
          ended_at?: string | null
          group_id: string
          id?: string
          name: string
          started_at?: string
        }
        Update: {
          ended_at?: string | null
          group_id?: string
          id?: string
          name?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          created_at: string
          group_id: string
          id: string
          played_on: string
          rotation_mode: string
          season_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          played_on?: string
          rotation_mode?: string
          season_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          played_on?: string
          rotation_mode?: string
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_locker: { Args: Record<string, never>; Returns: Json }
      buy_cosmetic: { Args: { p_item_id: string; p_request_id: string }; Returns: Json }
      buy_chest: { Args: { p_tier: string; p_request_id: string }; Returns: Json }
      open_chest: { Args: { p_tier: string; p_request_id: string }; Returns: Json }
      save_mascot: { Args: { p_skin: string; p_hair: string; p_equipped: Json }; Returns: undefined }
      group_mascots: { Args: { p_group_id: string }; Returns: Json }
      get_match_rewards: { Args: { p_match_id: string }; Returns: Json }
      approve_room_member: { Args: { p_group_id: string; p_user_id: string }; Returns: string }
      reject_room_member: { Args: { p_group_id: string; p_user_id: string }; Returns: string }
      is_room_owner: { Args: { gid: string }; Returns: boolean }
      claim_username: { Args: { p_username: string }; Returns: string }
      create_room: { Args: { p_name: string; p_room_id: string; p_pin: string }; Returns: string }
      join_room: { Args: { p_group_id: string; p_pin: string }; Returns: Json }
      set_room_pin: { Args: { p_group_id: string; p_pin: string }; Returns: string }
      room_pin_configured: { Args: { p_group_id: string }; Returns: boolean }
      can_manage_group: { Args: { gid: string }; Returns: boolean }
      is_group_member: { Args: { gid: string }; Returns: boolean }
      is_group_owner: { Args: { gid: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      set_profile_gender: { Args: { p_gender: string }; Returns: string }
      set_player_gender: { Args: { p_group_id: string; p_player_id: string; p_gender: string }; Returns: string }
      set_session_rotation: { Args: { p_group_id: string; p_session_id: string; p_rotation_mode: string }; Returns: string }
      release_retained_pair: { Args: { p_group_id: string; p_session_id: string; p_court_no: number; p_retained_match_id: string }; Returns: string }
      get_pair_head_to_head: { Args: { p_group_id: string; p_team_a: string[]; p_team_b: string[] }; Returns: { played: number; team_a_wins: number; team_b_wins: number; draws: number }[] }
      save_session_court: { Args: { p_group_id: string; p_session_id: string; p_court_no: number; p_starts_at: string; p_ends_at: string }; Returns: string }
      begin_match: {
        Args: { p_client_id: string; p_session_id: string; p_group_id: string; p_court_no: number; p_mode: Database["public"]["Enums"]["queue_mode"]; p_balance_weight: number; p_team_a: string[]; p_team_b: string[] }
        Returns: string
      }
      get_player_durations: { Args: { p_group_id: string }; Returns: { player_id: string; average_minutes: number; timed_games: number }[] }
      record_match: {
        Args: {
          p_balance_weight: number
          p_client_id: string
          p_court_no: number
          p_group_id: string
          p_mode: Database["public"]["Enums"]["queue_mode"]
          p_session_id: string
          p_team_a: string[]
          p_team_b: string[]
          p_winner_team: number
        }
        Returns: string
      }
    }
    Enums: {
      member_role: "owner" | "admin" | "member"
      queue_mode: "manual" | "fair" | "mix" | "balance"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      member_role: ["owner", "admin", "member"],
      queue_mode: ["manual", "fair", "mix", "balance"],
    },
  },
} as const

