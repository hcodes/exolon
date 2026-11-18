import { createNativeModel } from '../../16bit/model/index.ts';
import { AMIGA_NATIVE } from '../constants/index.ts';
const model = createNativeModel(AMIGA_NATIVE);
export const createAmigaState = model.createState;
export const stepAmiga = model.step;
export const nativeAmigaOverlap = model.overlap;
