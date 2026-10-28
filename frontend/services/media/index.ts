// [REFACTOR-20260808-SVCGROUP] Barrel for the `media` service group (content assets: object images,
// image categories, image storage, image-link utils, flex messages). Importers target
// `../services/media`. Members are side-effect-free named exports, so `export *` is behavior-identical.
// revert: `git mv services/media/*.ts services/`, delete this folder, repoint importers back to
// `../services/<file>`, and restore the moved files' `./apiClient` / `../types` paths.
export * from './objectImageService';
export * from './objectCategoryService';
export * from './imageStorageService';
export * from './imageLinkUtils';
export * from './flexMessageService';
export * from './mediaPickerService';
