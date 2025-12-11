/**
 * mottvt.com Worker - Contact Form & Visitor Counter
 *
 * Endpoints:
 * - POST /api/contact - Handle contact form submissions
 * - POST /api/visitor - Track a page view
 * - GET /api/visitor - Get visitor count
 */

interface Env {
	VISITOR_STATS: KVNamespace;
	RESEND_API_KEY: string;
	ASSETS: Fetcher;
}

interface ContactFormData {
	name: string;
	email: string;
	message: string;
	turnstileToken: string;
}

// CORS headers for cross-origin requests
const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		// Contact Form Handler
		if (url.pathname === '/api/contact' && request.method === 'POST') {
			return handleContactForm(request, env);
		}

		// Visitor Counter - Track visit
		if (url.pathname === '/api/visitor' && request.method === 'POST') {
			return handleVisitorTrack(env);
		}

		// Visitor Counter - Get count
		if (url.pathname === '/api/visitor' && request.method === 'GET') {
			return handleVisitorGet(env);
		}

		// Serve static assets for all other requests
		// This ensures static files work correctly with custom domains
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;

/**
 * Verify Turnstile token with Cloudflare
 */
async function verifyTurnstileToken(token: string, remoteIP: string): Promise<boolean> {
	const TURNSTILE_SECRET_KEY = '0x4AAAAAAB5rM4GOGc0vNpg5KeCmSdRia4Q';

	const formData = new FormData();
	formData.append('secret', TURNSTILE_SECRET_KEY);
	formData.append('response', token);
	formData.append('remoteip', remoteIP);

	const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		method: 'POST',
		body: formData,
	});

	const outcome = await result.json() as { success: boolean };
	return outcome.success;
}

/**
 * Send email notification using Resend API
 */
async function sendContactNotification(env: Env, data: ContactFormData): Promise<void> {
	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${env.RESEND_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			from: 'mottvt.com Contact Form <noreply@mottvt.com>',
			to: ['mike@mottvt.com'],
			subject: `New Contact Form Submission from ${data.name}`,
			html: `
				<h2>New Contact Form Submission</h2>
				<p><strong>From:</strong> ${data.name}</p>
				<p><strong>Email:</strong> ${data.email}</p>
				<p><strong>Message:</strong></p>
				<p>${data.message.replace(/\n/g, '<br>')}</p>
				<hr>
				<p style="color: #666; font-size: 12px;">Reply to: ${data.email}</p>
			`
		})
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Resend API error: ${error}`);
	}
}

/**
 * Handle contact form submission
 */
async function handleContactForm(request: Request, env: Env): Promise<Response> {
	try {
		const data: ContactFormData = await request.json();

		// Validate required fields
		if (!data.name || !data.email || !data.message || !data.turnstileToken) {
			return new Response(
				JSON.stringify({ error: 'Missing required fields' }),
				{
					status: 400,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				}
			);
		}

		// Verify Turnstile token
		const clientIP = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
		const isValidToken = await verifyTurnstileToken(data.turnstileToken, clientIP);

		if (!isValidToken) {
			return new Response(
				JSON.stringify({ error: 'Invalid verification. Please try again.' }),
				{
					status: 403,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				}
			);
		}

		// Basic email validation
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(data.email)) {
			return new Response(
				JSON.stringify({ error: 'Invalid email address' }),
				{
					status: 400,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				}
			);
		}

		// Log the submission
		console.log('Contact form submission:', {
			name: data.name,
			email: data.email,
			message: data.message,
			timestamp: new Date().toISOString(),
		});

		// Send email notification
		try {
			await sendContactNotification(env, data);
		} catch (emailError) {
			console.error('Failed to send email notification:', emailError);
			// Continue even if email fails - don't want to show error to user
		}

		return new Response(
			JSON.stringify({
				success: true,
				message: 'Thank you for your message! I\'ll get back to you soon.'
			}),
			{
				status: 200,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' }
			}
		);
	} catch (error) {
		console.error('Error handling contact form:', error);
		return new Response(
			JSON.stringify({ error: 'Internal server error' }),
			{
				status: 500,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' }
			}
		);
	}
}

/**
 * Track a visitor and increment counter
 */
async function handleVisitorTrack(env: Env): Promise<Response> {
	try {
		const VISITOR_KEY = 'total_visitors';

		// Get current count
		const currentCount = await env.VISITOR_STATS.get(VISITOR_KEY);
		const newCount = currentCount ? parseInt(currentCount) + 1 : 1;

		// Update count
		await env.VISITOR_STATS.put(VISITOR_KEY, newCount.toString());

		return new Response(
			JSON.stringify({
				success: true,
				count: newCount
			}),
			{
				status: 200,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' }
			}
		);
	} catch (error) {
		console.error('Error tracking visitor:', error);
		return new Response(
			JSON.stringify({ error: 'Internal server error' }),
			{
				status: 500,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' }
			}
		);
	}
}

/**
 * Get current visitor count
 */
async function handleVisitorGet(env: Env): Promise<Response> {
	try {
		const VISITOR_KEY = 'total_visitors';
		const count = await env.VISITOR_STATS.get(VISITOR_KEY);

		return new Response(
			JSON.stringify({
				count: count ? parseInt(count) : 0
			}),
			{
				status: 200,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' }
			}
		);
	} catch (error) {
		console.error('Error getting visitor count:', error);
		return new Response(
			JSON.stringify({ error: 'Internal server error' }),
			{
				status: 500,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' }
			}
		);
	}
}
