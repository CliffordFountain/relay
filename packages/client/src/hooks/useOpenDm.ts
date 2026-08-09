import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch } from './useAppDispatch';
import { api } from '../api/rest';
import { addDmChannel, selectDmChannel } from '../stores/dmSlice';
import { addChannel, selectChannel } from '../stores/channelsSlice';

/**
 * Opens (creating if needed) a direct message with a user and navigates to it.
 * Shared by every "Message this user" affordance so the flow is identical
 * everywhere (member list, a message author, friends, etc.).
 */
export function useOpenDm() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  return useCallback(
    (userId: string) => {
      api
        .createDm(userId)
        .then((dm) => {
          dispatch(addDmChannel(dm));
          dispatch(
            addChannel({
              id: dm.id,
              guild_id: null,
              type: dm.type,
              name: dm.recipients[0]?.username ?? 'Direct Message',
              topic: null,
              position: 0,
              parent_id: null,
            }),
          );
          dispatch(selectDmChannel(dm.id));
          dispatch(selectChannel(dm.id));
          navigate(`/channels/@me/${dm.id}`);
        })
        .catch(() => {
          /* transient failure — nothing actionable to show */
        });
    },
    [dispatch, navigate],
  );
}
