#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

in vec2 fragUV;          // UV coordinates of this fragment
out vec4 cellValue;      // The next value for this cell

uniform sampler2D x;
uniform sampler2D y;
uniform float alpha;
uniform float beta;
uniform vec2 res;


void main(){
    vec4 left  = texture(x, fragUV - vec2(1, 0) / res);
    vec4 right = texture(x, fragUV + vec2(1, 0) / res);
    vec4 up    = texture(x, fragUV + vec2(0, 1) / res);
    vec4 down  = texture(x, fragUV - vec2(0, 1) / res);

    vec4 neighbors = left + right + up + down;
    vec4 self = texture(y, fragUV);

    cellValue = (alpha * self + neighbors) / beta;
}