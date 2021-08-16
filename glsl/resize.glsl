#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

in vec2 fragUV;
out vec4 fragColor;

uniform sampler2D oldTexture;
uniform vec2 scale;

void main(){
    fragColor = vec4(scale, 1., 1.) * texture(oldTexture, fragUV);
}