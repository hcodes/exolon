/* Offline rendering of unmodified ST PSG writes using upstream Ayumi, MIT. */
#include "atari-st.ayumi.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <string.h>
static void u16(FILE *f,unsigned n){fputc(n&255,f);fputc(n>>8&255,f);}
static void u32(FILE *f,unsigned n){u16(f,n&65535);u16(f,n>>16);}
int main(int argc,char **argv){
 if(argc!=4 && argc!=5)return 1;
 if(argc==5 && strcmp(argv[4], "50"))return 1;
 const int rate=44100, ticks=atoi(argv[3]);
 /* Native TimerA:2.4576MHz /200 /244 =3072/61Hz; optional50Hz archive. */
 const uint64_t numerator=argc==5 ? 50 : 3072, denominator=argc==5 ? 1 : 61;
 const uint32_t count=((uint64_t)ticks*rate*denominator+numerator-1)/numerator;
 FILE *in=fopen(argv[1],"rb"),*out=fopen(argv[2],"wb");if(!in||!out)return 2;
 struct ayumi chip;ayumi_configure(&chip,1,2000000,rate);
 /* ST is mono; use1/3 level per channel to preserve headroom. */
 for(int c=0;c<3;c++){chip.channels[c].pan_left=1.0/3;chip.channels[c].pan_right=0;}
 fwrite("RIFF",1,4,out);u32(out,36+count*2);fwrite("WAVEfmt ",1,8,out);u32(out,16);u16(out,1);u16(out,1);u32(out,rate);u32(out,rate*2);u16(out,2);u16(out,16);fwrite("data",1,4,out);u32(out,count*2);
 int previous=-1;unsigned char r[14];
 for(uint32_t sample=0;sample<count;sample++){
  const int frame=(uint64_t)sample*numerator/((uint64_t)rate*denominator);
  if(frame!=previous){
   if(fread(r,1,14,in)!=14)return 3;
   for(int c=0;c<3;c++){
    ayumi_set_tone(&chip,c,r[c*2]|r[c*2+1]<<8);
    ayumi_set_mixer(&chip,c,r[7]>>c,r[7]>>(c+3),r[8+c]>>4&1);
    ayumi_set_volume(&chip,c,r[8+c]);
   }
   ayumi_set_noise(&chip,r[6]);ayumi_set_envelope(&chip,r[11]|r[12]<<8);
   /* The original driver writes R13 every tick, including zero. */
   ayumi_set_envelope_shape(&chip,r[13]);previous=frame;
  }
  ayumi_process(&chip);ayumi_remove_dc(&chip);
  long value=lround(chip.left*32767);if(value>32767)value=32767;if(value< -32768)value=-32768;
  u16(out,(uint16_t)value);
 }
 fclose(in);fclose(out);return 0;
}
