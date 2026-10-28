/**
 * [FEAT-20261027-TANSTACK] Object album reads (objectCategoryService / objectImageService, unchanged).
 * Both screens: no poll, loading on every read, a failed read keeps the rows (onFailure 'keep').
 * `useObjectCategoriesQuery` — the category filter of the album screen (one read per mount).
 * Services come through the `services/media` BARREL (tests mock it).
 */
import { useAppQuery, usePageQuery } from '../../query';
import { objectCategoryService, objectImageService } from '..';
import { mediaKeys } from './mediaKeys';

type CategoryParams = Parameters<typeof objectCategoryService.listCategories>[0];
type ImageParams = Parameters<typeof objectImageService.listImages>[0];

export const useObjectCategoriesPageQuery = (params: CategoryParams, onError?: (error: Error) => void) =>
  usePageQuery({
    queryKey: mediaKeys.objectCategories(params ?? {}),
    queryFn: () => objectCategoryService.listCategories(params),
    onFailure: 'keep',
    onError,
  });

export const useObjectCategoriesQuery = () =>
  useAppQuery({
    queryKey: mediaKeys.objectCategories({}),
    queryFn: () => objectCategoryService.listCategories(),
  });

export const useObjectImagesPageQuery = (params: ImageParams, onError?: (error: Error) => void) =>
  usePageQuery({
    queryKey: mediaKeys.objectImages(params ?? {}),
    queryFn: () => objectImageService.listImages(params),
    onFailure: 'keep',
    onError,
  });
