#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uPreviousFrame;
uniform vec2 uResolution;
uniform float uDeltaTime;
uniform int uReset;
in vec2 fragUV;

out vec4 fragColor;


void main(void){
    // fragUV is a vec2 with both components from [0, 1]. Multiplying it by our resolution will make each fragment's
    //  value for fragXY an integer which can be a helpful abstraction
    vec2 fragXY = fragUV * uResolution;

    switch(uReset){
        case 0: // Normal operation
        break;

        case 1: // Reset to lower-left-radial
        fragColor = vec4(1, 0, 0, length(fragUV / 1.5)); // Division by 1.5 forces alpha to [0, 1]
        return;
    }

    // For a simple demo, we will make each fragment approach the color of its neighbors
    vec4 self = texture(uPreviousFrame, fragUV);
    vec4 left = texture(uPreviousFrame, (fragXY + vec2(-1, 0))/uResolution);
    vec4 right = texture(uPreviousFrame, (fragXY + vec2(1, 0))/uResolution);
    vec4 up = texture(uPreviousFrame, (fragXY + vec2(0, -1))/uResolution);
    vec4 down = texture(uPreviousFrame, (fragXY + vec2(0, 1))/uResolution);

    vec4 avg = (left + right + up + down) / 4.0;

    fragColor = mix(self, avg, 0.5);

    // TODO: Take in velocities + densities and output next values
}