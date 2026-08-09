import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export enum RelationshipType {
  NONE = 0,
  FRIEND = 1,
  BLOCKED = 2,
  INCOMING_REQUEST = 3,
  OUTGOING_REQUEST = 4,
}

export interface RelationshipUser {
  id: string;
  username: string;
  avatar: string | null;
  display_name?: string;
}

export interface Relationship {
  id: string;
  type: RelationshipType;
  user: RelationshipUser;
}

interface RelationshipsState {
  relationships: Record<string, Relationship>;
  isLoading: boolean;
}

const initialState: RelationshipsState = {
  relationships: {},
  isLoading: false,
};

export const relationshipsSlice = createSlice({
  name: 'relationships',
  initialState,
  reducers: {
    setRelationships: (state, action: PayloadAction<Relationship[]>) => {
      state.relationships = {};
      for (const rel of action.payload) {
        state.relationships[rel.user.id] = rel;
      }
    },
    addRelationship: (state, action: PayloadAction<Relationship>) => {
      state.relationships[action.payload.user.id] = action.payload;
    },
    removeRelationship: (state, action: PayloadAction<string>) => {
      delete state.relationships[action.payload];
    },
    updateRelationship: (state, action: PayloadAction<Relationship>) => {
      state.relationships[action.payload.user.id] = action.payload;
    },
    setRelationshipsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
  },
});

export const {
  setRelationships,
  addRelationship,
  removeRelationship,
  updateRelationship,
  setRelationshipsLoading,
} = relationshipsSlice.actions;
