#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

in vec2 fragUV;          // UV coordinates of this fragment
out vec4 cellValue;      // The divergence of this cell

uniform sampler2D field; // The input vector field
uniform vec2 res;        // The texture resolution

void main(){
    vec4 left  = texture(field, fragUV - vec2(1, 0) / res);
    vec4 right = texture(field, fragUV + vec2(1, 0) / res);
    vec4 down  = texture(field, fragUV - vec2(0, 1) / res);
    vec4 up    = texture(field, fragUV + vec2(0, 1) / res);

    // We're assuming a 2D vector field here
    float divergence = (right.x - left.x + up.y - down.y) * 0.5;
    cellValue = vec4(divergence, 0., 0., 0.);
}

