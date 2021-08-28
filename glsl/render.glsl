#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

in vec2 fragUV;         // UV coordinates for this fragment
out vec4 fragColor;     // Output color for this fragment

uniform sampler2D dye;  // Dye amount texture
uniform sampler2D vel;  // Fluid velocity texture

void main(){
    float d = texture(dye, fragUV).x;
    vec2 v = texture(vel, fragUV).xy;

    fragColor = vec4(d, v, 1.);
    fragColor = vec4(d, 0., 0., 1.);
}