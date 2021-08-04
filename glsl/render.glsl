#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

in vec2 fragUV;
out vec4 fragColor;

void main(){
    fragColor = vec4(fragUV, 0., 1.);
}