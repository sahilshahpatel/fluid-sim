#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

in vec3 aVertexPosition;

out vec2 fragUV;


void main(void) {
    gl_Position = vec4(aVertexPosition, 1.0);
    fragUV = 0.5 * aVertexPosition.xy + 0.5; // Move from [-1, 1] to [0, 1]
}