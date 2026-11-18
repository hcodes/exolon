import { createNativeModel } from '../../16bit/model/index.ts';
import { ATARI_ST_NATIVE } from '../constants/index.ts';
import { nextAtariStRandomByte } from '../utils/random.ts';
const model = createNativeModel(ATARI_ST_NATIVE, nextAtariStRandomByte);
export const createAtariStState = model.createState;
export const stepAtariSt = model.step;
