import { runConformance } from '@vfskit/core/conformance'
import { s3, memoryS3 } from './index'

runConformance(() => s3({ client: memoryS3() }))
