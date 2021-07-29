#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif


// Program Description:
// ----------------------------------------------------------------------------------------------------------------------
// Jacobi iteration is a way to solve systems of linear equations iteratively. It is similar to the Gauss-Seidel method,
// with a slight difference (see https://www.sciencedirect.com/topics/engineering/gauss-seidel-method). We use it in 
// both the diffusion and projections stages to figure out which next-frame values of different quantities. Running this
// shader once constitutes one iteration of the process. 20-40 runs might be required for solid convergence.
//
// All our equations can be put in the form:
// xNext[i][j] = (x[i-1][j]) + x[i+1][j] + x[i][j-1] + x[i][j+1] + alpha * b[i][j]) / beta 
// ----------------------------------------------------------------------------------------------------------------------

in vec2 fragUV;             // Fragment position with [0, 1] coordinates and bottom-left origin
out vec4 xNext;             // The next iteration value for this cell

// See equation above for uniform meanings
uniform sampler2D x;
uniform sampler2D b;
uniform float alpha;
uniform float rBeta;        // 1/beta because multiplication is faster than division
uniform vec2 res;           // Texture resolution


void main(){
    // Get neighboring cell's data
    vec4 left  = texture(x, fragUV + vec2(-1,  0) / res);
    vec4 right = texture(x, fragUV + vec2( 1,  0) / res);
    vec4 down  = texture(x, fragUV + vec2( 0, -1) / res);
    vec4 up    = texture(x, fragUV + vec2( 0,  1) / res);

    // Get self data
    vec4 self  = texture(b, fragUV);

    xNext = (left + right + down + up + alpha * self) * rBeta;
}