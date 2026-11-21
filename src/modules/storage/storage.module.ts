import { Module } from '@nestjs/common';

import { PhotoStorage } from './photo-storage.js';

/** S3-compatible object storage of vessel photos. */
@Module({ providers: [PhotoStorage], exports: [PhotoStorage] })
export class StorageModule {}
