/**
 * [FEAT-20261027-TANSTACK] `useQuery` / `useMutation` bound to the app client.
 * Module query hooks call these instead of the raw TanStack hooks so the client
 * can never be accidentally omitted or swapped (see queryClient.ts for why it is
 * passed explicitly rather than read from context).
 */
import {
  useMutation,
  useQuery,
  type DefaultError,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { queryClient } from './queryClient';

export const useAppQuery = <TQueryFnData, TData = TQueryFnData, TKey extends QueryKey = QueryKey>(
  options: UseQueryOptions<TQueryFnData, DefaultError, TData, TKey>,
) => useQuery(options, queryClient);

export const useAppMutation = <TData, TVariables = void>(
  options: UseMutationOptions<TData, DefaultError, TVariables>,
) => useMutation(options, queryClient);
