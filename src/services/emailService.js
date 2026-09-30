const { Resend } = require('resend')
const resend = new Resend(process.env.RESEND_API_KEY)

const rawFrom = process.env.FROM_EMAIL || 'noreply@warexhub.com'
const emailMatch = rawFrom.match(/<([^>]+)>/)
const baseEmail = emailMatch ? emailMatch[1] : (rawFrom.includes('@') ? rawFrom.trim() : 'noreply@warexhub.com')

// Default Platform sender: "WareXhub <noreply@warexhub.com>"
const FROM_DEFAULT = `WareXhub <${baseEmail}>`
// Deals / Proforma sender: "WareXhub Deals <noreply@warexhub.com>"
const FROM_DEALS = `WareXhub Deals <${baseEmail}>`
const ADMIN = process.env.ADMIN_EMAIL || 'admin@warexhub.com'
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://uat.warexhub.com'

// Base send function — never crashes main flow
async function sendEmail({ from, to, subject, html, attachments }) {
  try {
    const payload = {
      from: from || FROM_DEFAULT,
      to,
      reply_to: ADMIN,
      subject,
      html
    }
    if (attachments && Array.isArray(attachments)) {
      payload.attachments = attachments;
    }
    const { data, error } = await resend.emails.send(payload);
    if (error) throw error
    console.log(`📧 [EMAIL] Sent to ${to}: ${subject}`)
    return data
  } catch (err) {
    console.error('❌ [EMAIL] Failed:', err.message)
    // Never throw — email fail se API crash nahi hoga
  }
}

// Base HTML template
function baseTemplate(content, options = {}) {
  return `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;
      background:#f5f5f5;font-family:sans-serif">
      <div style="max-width:600px;margin:40px auto;
        background:#fff;border-radius:12px;
        overflow:hidden;box-shadow:0 2px 8px
        rgba(0,0,0,0.08)">

        <!-- Header -->
        <div style="background:#4A3A5C; padding:24px 32px; text-align:center">
          <div style="background:white; display:inline-block; padding:10px 24px; border-radius:12px; box-shadow:0 2px 4px rgba(0,0,0,0.1)">
            <img src="https://jgtjtabsjkecneajloia.supabase.co/storage/v1/object/public/avatars/branding/logo.png" alt="WareXhub" style="height:35px; width:auto; display:block" />
          </div>
        </div>

        <!-- Body -->
        <div style="padding:32px">
          ${content}

          <!-- Standard Sign-off -->
          <div style="margin-top:28px;padding-top:18px;border-top:1px solid #EAE6F0">
            <p style="margin:0 0 12px;font-size:13px;color:#333">
              Best regards,<br/>
              <strong style="color:#4A3A5C">WareXhub Team</strong>
            </p>
            <div style="background:#FAF8FC;border:1px solid #EAE4F2;border-radius:8px;padding:10px 14px;margin-top:12px">
              <p style="margin:0;font-size:11px;color:#6B5E7A;line-height:1.45">
                ⚠️ <strong>Do Not Reply Directly:</strong> This is an automated email sent from a notification-only address. For any queries, assistance, or orders, please contact our support team at <a href="mailto:${ADMIN}" style="color:#4A3A5C;font-weight:700;text-decoration:underline">${ADMIN}</a>.
              </p>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="background:#4A3A5C; padding:28px 32px; border-top:1px solid #574B66; text-align:center">
          <p style="color:#E8DDF5; font-size:12px; margin:0 0 16px 0; line-height:1.5">
            ${options && options.notificationLine ? options.notificationLine : 'This is an automated security notification from WareXhub.'}
          </p>
          <div style="margin-bottom:18px">
            <a href="${FRONTEND_URL}" style="color:white; text-decoration:none; font-size:12px; margin:0 12px">Website</a>
            <a href="${FRONTEND_URL}/contact" style="color:white; text-decoration:none; font-size:12px; margin:0 12px">Support</a>
            <a href="${FRONTEND_URL}/privacy" style="color:white; text-decoration:none; font-size:12px; margin:0 12px">Privacy</a>
          </div>
          <p style="color:rgba(232,221,245,0.7); font-size:11px; margin:0 0 6px 0">
            © 2026 WareXhub. All rights reserved.
          </p>
          <p style="color:rgba(232,221,245,0.6); font-size:11px; margin:0">
            <a href="https://brandnestagency.vercel.app" target="_blank" rel="noopener noreferrer" style="color:#E8DDF5; text-decoration:underline; font-weight:600">Developed by Brandnest - India's First AI Powered Digital agency</a>
          </p>
          <div style="display:none; font-size:1px; color:#4A3A5C; line-height:1px; max-height:0px; max-width:0px; opacity:0; overflow:hidden;">
            ${Date.now()}
          </div>
        </div>
      </div>
    </body>
    </html>
  `
}

// ─── EMAIL FUNCTIONS ─────────────────────────────

// 1. Admin — New Registration
async function sendNewRegistrationAlert(member) {
  await sendEmail({
    to: ADMIN,
    subject: `New Registration — ${member.company_name}`,
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        New Member Registration
      </h2>
      <p style="color:#666">
        A new member has registered on WareXhub
        and is awaiting your approval.
      </p>
      <table style="width:100%;border-collapse:
        collapse;margin:20px 0">
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999;
            width:140px">Company</td>
          <td style="padding:10px 0;font-weight:600">
            ${member.company_name}
          </td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">
            Contact Person
          </td>
          <td style="padding:10px 0">
            ${member.first_name} ${member.last_name}
          </td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">
            Email
          </td>
          <td style="padding:10px 0">
            ${member.email}
          </td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">
            Login ID
          </td>
          <td style="padding:10px 0;
            font-family:monospace;font-weight:600">
            W-${member.vat_number}
          </td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">
            Industry
          </td>
          <td style="padding:10px 0">
            ${member.industry}
            ${member.industry_other ? ` — ${member.industry_other}` : ''}
          </td>
        </tr>
      </table>
      <a href="${FRONTEND_URL}/admin/registrations"
        style="display:inline-block;
        background:#4A3A5C;color:white;
        padding:12px 28px;border-radius:8px;
        text-decoration:none;font-weight:600;
        margin-top:8px">
        Review Registration →
      </a>
    `)
  })
}

// 2. Member — Account Approved
async function sendApprovalEmail(member, tempPassword) {
  await sendEmail({
    to: member.email,
    subject: '✅ WareXhub Account Approved — Your Login Details',
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        Your Account is Approved!
      </h2>
      <p>Dear <strong>${member.first_name} (${member.company_name})</strong>,</p>
      <p style="color:#666">
        Welcome to WareXhub! Your account has been
        approved. Here are your WareXhub login credentials:
      </p>
      <div style="background:#F3F1F7;
        border-radius:8px;padding:24px;
        margin:20px 0; border: 1px solid #E5E5E5">
        <h3 style="color:#4A3A5C;margin:0 0 16px 0;font-size:16px">Your WareXhub Login Credentials</h3>
        
        <div style="margin-bottom:15px">
          <p style="margin:0 0 5px 0;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:1px">Login ID</p>
          <div style="background:white;padding:12px;border-radius:6px;border:1px solid #ddd;display:flex;justify-content:space-between;align-items:center">
            <span style="font-family:monospace;font-size:16px;font-weight:700;color:#4A3A5C">W-${member.vat_number}</span>
          </div>
        </div>

        <div style="margin-bottom:10px">
          <p style="margin:0 0 5px 0;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:1px">Temporary Password</p>
          <div style="background:white;padding:12px;border-radius:6px;border:1px solid #ddd;display:flex;justify-content:space-between;align-items:center">
            <span style="font-family:monospace;font-size:16px;font-weight:700;color:#4A3A5C">${tempPassword}</span>
          </div>
        </div>
        
        <p style="margin:10px 0 0 0;font-size:11px;color:#888;font-style:italic">
          Tip: You can select and copy the text above to paste in the login screen.
        </p>
      </div>

      <p style="color:#e53e3e;font-size:13px;
        background:#fff5f5;padding:14px;
        border-radius:6px;border-left:4px solid #e53e3e; margin:20px 0">
        ⚠️ <strong>IMPORTANT:</strong> For security, please change this password immediately after your first login in your Profile settings.
      </p>
      
      <div style="text-align:center;margin-top:25px">
        <a href="${FRONTEND_URL}/login?hint=true"
          style="display:inline-block;
          background:#4A3A5C;color:white;
          padding:14px 40px;border-radius:8px;
          text-decoration:none;font-weight:700;
          font-size:16px;box-shadow: 0 4px 6px rgba(74,58,92,0.2)">
          Login Now →
        </a>
      </div>
    `)
  })

  // Send separate alert to Admin
  await sendAdminApprovalAlert(member, tempPassword);
}

// 2.5 Admin — Account Approved Alert
async function sendAdminApprovalAlert(member, tempPassword) {
  await sendEmail({
    to: ADMIN,
    subject: `🔐 Admin Alert: Credentials Sent to W-${member.vat_number}`,
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        Member Approved & Credentials Sent
      </h2>
      <p>Hello Admin,</p>
      <p style="color:#666">
        The registration for <strong>${member.full_name || member.first_name}</strong> has been approved. 
        The system has generated a temporary password and successfully emailed it to the client.
      </p>
      <p style="color:#666">
        If needed, you can also share these credentials with the client directly:
      </p>
      <div style="background:#F3F1F7;
        border-radius:8px;padding:24px;
        margin:20px 0; border: 1px solid #E5E5E5">
        <div style="margin-bottom:15px">
          <p style="margin:0 0 5px 0;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:1px">Login ID</p>
          <div style="background:white;padding:12px;border-radius:6px;border:1px solid #ddd;">
            <span style="font-family:monospace;font-size:16px;font-weight:700;color:#4A3A5C">W-${member.vat_number}</span>
          </div>
        </div>

        <div style="margin-bottom:10px">
          <p style="margin:0 0 5px 0;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:1px">Temporary Password</p>
          <div style="background:white;padding:12px;border-radius:6px;border:1px solid #ddd;">
            <span style="font-family:monospace;font-size:16px;font-weight:700;color:#4A3A5C">${tempPassword}</span>
          </div>
        </div>
      </div>
    `)
  })
}

// 3. Member — Account Rejected
async function sendRejectionEmail(member, reason) {
  await sendEmail({
    to: member.email,
    subject: 'WareXhub — Registration Update',
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        Registration Update
      </h2>
      <p>Dear <strong>${member.first_name} (${member.company_name})</strong>,</p>
      <p style="color:#666">
        Thank you for your interest in WareXhub.
        After careful review, we are unable to approve
        your registration at this time.
      </p>
      ${reason ? `
      <div style="background:#fff5f5;
        border:1px solid #fed7d7;
        border-radius:8px;padding:16px;margin:16px 0">
        <strong style="color:#c53030">Reason:</strong>
        <p style="margin:8px 0 0;color:#666">
          ${reason}
        </p>
      </div>` : ''}
      <p style="color:#666">
        For queries or to reapply, please contact us at
        <a href="mailto:${ADMIN}"
          style="color:#4A3A5C">${ADMIN}</a>
      </p>
    `)
  })
}

// 4. Seller — Listing Approved
async function sendListingApprovedEmail(member, listing) {
  // Temporarily disabled to save email limits
  return;
  
  await sendEmail({
    to: member.email,
    subject: `✅ Listing Approved — ${listing.request_id}`,
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        Your Listing is Live!
      </h2>
      <p>Dear <strong>${member.first_name} (${member.company_name})</strong>,</p>
      <p style="color:#666">
        Your listing has been approved and is now
        visible to buyers on WareXhub.
      </p>
      <div style="background:#f0fdf4;
        border:1px solid #bbf7d0;border-radius:8px;
        padding:16px;margin:16px 0">
        <p style="margin:0;color:#666">Request ID</p>
        <p style="margin:4px 0 0;font-family:monospace;
          font-size:18px;font-weight:700;
          color:#4A3A5C">
          ${listing.request_id}
        </p>
        <p style="margin:8px 0 0;color:#666">Item</p>
        <p style="margin:4px 0 0;font-weight:600">
          ${listing.name}
        </p>
      </div>
      <a href="${FRONTEND_URL}/dashboard/inventory"
        style="display:inline-block;
        background:#4A3A5C;color:white;
        padding:12px 28px;border-radius:8px;
        text-decoration:none;font-weight:600">
        View My Inventory →
      </a>
    `)
  })
}

// 5. Seller — Listing Correction Needed
async function sendListingCorrectionEmail(member, listing, reason) {
  await sendEmail({
    to: member.email,
    subject: `⚠️ Correction Required — ${listing.request_id}`,
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        Correction Required
      </h2>
      <p>Dear <strong>${member.first_name} (${member.company_name})</strong>,</p>
      <p style="color:#666">
        Your listing requires some corrections
        before it can be approved.
      </p>
      <div style="background:#fffbeb;
        border:1px solid #fde68a;border-radius:8px;
        padding:16px;margin:16px 0">
        <p style="margin:0;color:#666">Request ID</p>
        <p style="margin:4px 0 8px;
          font-family:monospace;font-weight:700;
          color:#4A3A5C">
          ${listing.request_id}
        </p>
        ${reason ? `
        <p style="margin:0;color:#666">
          Reason:
        </p>
        <p style="margin:4px 0 0;color:#92400e">
          ${reason}
        </p>` : ''}
      </div>
      <a href="${FRONTEND_URL}/dashboard/inventory"
        style="display:inline-block;
        background:#4A3A5C;color:white;
        padding:12px 28px;border-radius:8px;
        text-decoration:none;font-weight:600">
        Fix Listing →
      </a>
    `)
  })
}

// 6. Admin — New Listing Submitted
async function sendNewListingAlert(member, listing) {
  // Temporarily disabled to save email limits
  return;
  
  await sendEmail({
    to: ADMIN,
    subject: `New Listing — ${listing.request_id}`,
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        New Listing Submitted
      </h2>
      <p style="color:#666">
        A seller has submitted a new listing
        for review.
      </p>
      <table style="width:100%;border-collapse:collapse;
        margin:16px 0">
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999;
            width:130px">Request ID</td>
          <td style="padding:10px 0;
            font-family:monospace;font-weight:600">
            ${listing.request_id}
          </td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">
            Item
          </td>
          <td style="padding:10px 0;font-weight:600">
            ${listing.name}
          </td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">
            Seller
          </td>
          <td style="padding:10px 0">
            ${member.company_name}
          </td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#999">
            Selling Price
          </td>
          <td style="padding:10px 0;font-weight:600">
            NPR ${parseFloat(
      listing.seller_bid_price || 0
    ).toLocaleString()}
          </td>
        </tr>
      </table>
      <a href="${FRONTEND_URL}/admin/pending"
        style="display:inline-block;
        background:#4A3A5C;color:white;
        padding:12px 28px;border-radius:8px;
        text-decoration:none;font-weight:600">
        Review Listing →
      </a>
    `)
  })
}

// 7. Admin — Membership Plan Request
async function sendMembershipRequestAlert(member, plan) {
  await sendEmail({
    to: ADMIN,
    subject: `Membership Request — ${member.company_name}`,
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        Membership Plan Request
      </h2>
      <p style="color:#666">
        A member wants to upgrade their plan.
      </p>
      <table style="width:100%;border-collapse:
        collapse;margin:16px 0">
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999;
            width:130px">Member</td>
          <td style="padding:10px 0;font-weight:600">
            ${member.company_name}
          </td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">
            Login ID
          </td>
          <td style="padding:10px 0;
            font-family:monospace">
            W-${member.vat_number}
          </td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">
            Email
          </td>
          <td style="padding:10px 0">
            ${member.email}
          </td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#999">
            Requested Plan
          </td>
          <td style="padding:10px 0;font-weight:600;
            color:#4A3A5C">
            ${plan}
          </td>
        </tr>
      </table>
      <a href="${FRONTEND_URL}/admin/membership"
        style="display:inline-block;
        background:#4A3A5C;color:white;
        padding:12px 28px;border-radius:8px;
        text-decoration:none;font-weight:600">
        Review Request →
      </a>
    `)
  })
}

// 8. Guest — Thank You for Inquiry
async function sendGuestThankYouEmail(lead, listingName) {
  await sendEmail({
    to: lead.email,
    subject: `WareXhub — Inquiry Received`,
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        Thank You for Your Inquiry
      </h2>
      <p>Dear <strong>${lead.name}</strong>,</p>
      <p style="color:#666">
        We have received your message regarding <strong>${listingName || 'an item on WareXhub'}</strong>.
        Our team will review your inquiry and get back to you very soon.
      </p>
      ${lead.message ? `
      <div style="background:#f9f9fb;
        border-radius:8px;padding:16px;
        margin:16px 0; border:1px solid #e5e5e5">
        <p style="margin:0;color:#666;font-size:13px">Your Message:</p>
        <p style="margin:4px 0 0;font-style:italic">
          "${lead.message}"
        </p>
      </div>` : ''}
      <p style="color:#666">
        Want faster access and better deals? 
        <a href="${FRONTEND_URL}/register" style="color:#4A3A5C;font-weight:600">Register as a Member</a> today!
      </p>
    `)
  })
}

// 9. Admin — New Guest Lead Alert
async function sendNewLeadAlert(lead, listingName) {
  await sendEmail({
    to: ADMIN,
    subject: `New Guest Lead — ${lead.name}`,
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        New Lead Received
      </h2>
      <p style="color:#666">
        A guest has submitted a new inquiry.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999;width:130px">Name</td>
          <td style="padding:10px 0;font-weight:600">${lead.name}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">Email</td>
          <td style="padding:10px 0">${lead.email}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">Phone</td>
          <td style="padding:10px 0">${lead.phone || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">Listing</td>
          <td style="padding:10px 0">${listingName || 'N/A'}</td>
        </tr>
      </table>
      ${lead.message ? `
      <div style="background:#f9f9fb;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e5e5">
        <p style="margin:0;color:#666;font-size:13px">Message:</p>
        <p style="margin:4px 0 0;font-style:italic">"${lead.message}"</p>
      </div>` : ''}
      <a href="${FRONTEND_URL}/admin/leads"
        style="display:inline-block;background:#4A3A5C;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">
        View Leads →
      </a>
    `)
  })
}

// 10. Admin — New Contact Form Message
async function sendContactFormAlert(data) {
  await sendEmail({
    to: ADMIN,
    subject: `New Message: ${data.subject} — From ${data.name}`,
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        New Contact Form Message
      </h2>
      <p style="color:#666">
        You have received a new message from the website contact form.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999;width:130px">From</td>
          <td style="padding:10px 0;font-weight:600">${data.name}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">Email</td>
          <td style="padding:10px 0">${data.email}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">Company</td>
          <td style="padding:10px 0">${data.company || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">Subject</td>
          <td style="padding:10px 0;font-weight:600">${data.subject}</td>
        </tr>
      </table>
      <div style="background:#f9f9fb;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e5e5">
        <p style="margin:0;color:#666;font-size:13px">Message:</p>
        <p style="margin:4px 0 0;line-height:1.6">${data.message}</p>
      </div>
    `)
  })
}

// 10.5 Admin — Notify Me Alert (Out of Stock)
async function sendNotifyMeAlert(buyerData = {}, listing = {}, seller = {}) {
  const safeSeller = seller || {};
  const safeListing = listing || {};
  const safeBuyer = buyerData || {};
  await sendEmail({
    to: ADMIN,
    subject: `🚨 Out of Stock Inquiry — ${safeListing.name || 'Unknown Item'}`,
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        Out of Stock Item Inquiry
      </h2>
      <p style="color:#666">
        A buyer is interested in an item that is currently out of stock. Please try to source this item.
      </p>
      
      <h3 style="color:#4A3A5C;margin-bottom:8px">Buyer Details</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#f9f9fb;border:1px solid #e5e5e5;border-radius:8px">
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px;color:#999;width:130px">Name</td>
          <td style="padding:10px;font-weight:600">${safeBuyer.name || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px;color:#999">Email</td>
          <td style="padding:10px">${safeBuyer.email || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px;color:#999">Phone</td>
          <td style="padding:10px">${safeBuyer.phone || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px;color:#999">Company</td>
          <td style="padding:10px">${safeBuyer.company || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding:10px;color:#999">Quantity Needed</td>
          <td style="padding:10px;font-weight:600">${safeBuyer.quantity || '1'}</td>
        </tr>
      </table>

      <h3 style="color:#4A3A5C;margin-bottom:8px">Listing Details</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#f9f9fb;border:1px solid #e5e5e5;border-radius:8px">
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px;color:#999;width:130px">Item Name</td>
          <td style="padding:10px;font-weight:600">${safeListing.name || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px;color:#999">OEM</td>
          <td style="padding:10px;font-family:monospace">${safeListing.oem || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding:10px;color:#999">Listing Ref</td>
          <td style="padding:10px;font-family:monospace">${safeListing.request_id || 'N/A'}</td>
        </tr>
      </table>

      <h3 style="color:#4A3A5C;margin-bottom:8px">Original Seller Details</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#f9f9fb;border:1px solid #e5e5e5;border-radius:8px">
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px;color:#999;width:130px">Seller Company</td>
          <td style="padding:10px;font-weight:600">${safeSeller.company_name || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding:10px;color:#999">Seller ID</td>
          <td style="padding:10px;font-family:monospace">W-${safeSeller.vat_number || 'N/A'}</td>
        </tr>
      </table>
      
      <p style="color:#e53e3e;font-size:13px;background:#fff5f5;padding:14px;border-radius:6px;border-left:4px solid #e53e3e; margin:20px 0">
        <strong>Action Required:</strong> The buyer is waiting. Please contact sellers to source this item.
      </p>
    `)
  })
}

// 11. User — Contact Form Acknowledgement
async function sendContactFormThankYou(data) {
  await sendEmail({
    to: data.email,
    subject: `We've received your message — WareXhub`,
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        Message Received
      </h2>
      <p>Dear <strong>${data.name}</strong>,</p>
      <p style="color:#666">
        Thank you for reaching out to WareXhub. We have received your message regarding <strong>"${data.subject}"</strong>.
      </p>
      <p style="color:#666">
        Our team will review your inquiry and get back to you within 24 hours.
      </p>
      <div style="background:#f9f9fb;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e5e5">
        <p style="margin:0;color:#666;font-size:13px">A copy of your message:</p>
        <p style="margin:4px 0 0;font-style:italic;color:#555">"${data.message}"</p>
      </div>
      <p style="color:#666;font-size:13px">
        Best regards,<br/>
        <strong>WareXhub Team</strong>
      </p>
    `)
  })
}

// 12. User — Password Changed Confirmation
async function sendPasswordChangedEmail(user) {
  await sendEmail({
    to: user.email,
    subject: '🔐 Security Alert — Your password has been changed',
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        Password Changed Successfully
      </h2>
      <p>Dear <strong>${user.first_name || user.full_name} (${user.company_name})</strong>,</p>
      <p style="color:#666">
        This is a confirmation that the password for your WareXhub account has been successfully changed.
      </p>
      <div style="background:#F3F1F7; border-left:4px solid #4A3A5C; padding:16px; margin:20px 0">
        <p style="margin:0; font-size:14px; color:#4A3A5C">
          <strong>Security Tip:</strong> If you did not perform this action, please contact our support team immediately at 
          <a href="mailto:${ADMIN}" style="color:#4A3A5C; font-weight:700">${ADMIN}</a> to secure your account.
        </p>
      </div>
      <p style="color:#666; font-size:13px">
        Best regards,<br/>
        <strong>WareXhub Security Team</strong>
      </p>
    `)
  })
}

// 13. User — Forgot Password Temp Password
async function sendForgotPasswordEmail(user, tempPassword) {
  await sendEmail({
    to: user.email,
    subject: '🔑 Password Reset Request — Your Temporary Password',
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        Password Reset Request
      </h2>
      <p>Dear <strong>${user.first_name || user.full_name} (${user.company_name})</strong>,</p>
      <p style="color:#666">
        We received a request to reset the password for your WareXhub account (Login ID: <strong>W-${user.vat_number}</strong>). 
        Here is your new temporary password:
      </p>
      <div style="background:#F3F1F7;
        border-radius:8px;padding:24px;
        margin:20px 0; border: 1px solid #E5E5E5; text-align:center;">
        <span style="font-family:monospace;font-size:24px;font-weight:700;color:#4A3A5C;letter-spacing:2px;">
          ${tempPassword}
        </span>
      </div>
      <p style="color:#e53e3e;font-size:13px;
        background:#fff5f5;padding:14px;
        border-radius:6px;border-left:4px solid #e53e3e; margin:20px 0">
        ⚠️ <strong>IMPORTANT:</strong> For security, please login and change this password immediately in your Profile settings.
      </p>
      <div style="text-align:center;margin-top:25px">
        <a href="${FRONTEND_URL}/login"
          style="display:inline-block;
          background:#4A3A5C;color:white;
          padding:14px 40px;border-radius:8px;
          text-decoration:none;font-weight:700;
          font-size:16px;box-shadow: 0 4px 6px rgba(74,58,92,0.2)">
          Login Now →
        </a>
      </div>
    `)
  })
}

// 14. Admin — Forgot Password Alert
async function sendAdminForgotPasswordAlert(user, tempPassword) {
  await sendEmail({
    to: ADMIN,
    subject: `Password Reset Alert — W-${user.vat_number}`,
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        User Password Reset
      </h2>
      <p style="color:#666">
        A member has requested a password reset. A temporary password has been automatically generated and sent to them.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999;width:130px">User</td>
          <td style="padding:10px 0;font-weight:600">${user.full_name || user.first_name}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5">
          <td style="padding:10px 0;color:#999">Login ID</td>
          <td style="padding:10px 0;font-family:monospace;font-weight:600">W-${user.vat_number}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#999">Temp Password</td>
          <td style="padding:10px 0;font-family:monospace;font-weight:700;color:#4A3A5C">${tempPassword}</td>
        </tr>
      </table>
    `)
  })
}

// 15. User — Account Suspended
async function sendSuspensionEmail(user) {
  await sendEmail({
    to: user.email,
    subject: '⚠️ Account Suspended — WareXhub',
    html: baseTemplate(`
      <h2 style="color:#4A3A5C;margin-top:0">
        Account Suspended
      </h2>
      <p>Dear <strong>${user.first_name || user.full_name} (${user.company_name})</strong>,</p>
      <p style="color:#666">
        This is an automated notification to inform you that your WareXhub account (Login ID: <strong>W-${user.vat_number}</strong>) has been suspended by our administration team.
      </p>
      <div style="background:#fff5f5; border-left:4px solid #e53e3e; padding:16px; margin:20px 0">
        <p style="margin:0; font-size:14px; color:#e53e3e">
          <strong>Action Required:</strong> While suspended, you cannot log in and your active listings have been hidden from the public marketplace. 
          Please contact our support team to resolve this issue.
        </p>
      </div>
      <p style="color:#666; font-size:13px">
        Best regards,<br/>
        <strong>WareXhub Administration Team</strong>
      </p>
    `)
  })
}



// 16. Buyer — Proforma Invoice & Deal Initiated Alert
async function sendProformaToBuyerEmail(buyer, deal, pdfBuffer, proformaUrl, isRevised = false) {
  const dealRef = deal.deal_id || 'DEAL';
  const subjectText = isRevised
    ? `📄 Revised Proforma Invoice — ${dealRef}`
    : dealRef.startsWith('DEAL')
      ? `📄 Proforma Invoice Generated — ${dealRef}`
      : `📄 Proforma Invoice Generated — Deal ${dealRef}`;

  const attachments = [];
  if (pdfBuffer) {
    attachments.push({
      filename: `WareXhub_Proforma_${dealRef}.pdf`,
      content: pdfBuffer
    });
  }

  const finalPriceFormatted = Number(parseFloat(deal.final_price || 0).toFixed(2)).toLocaleString('en-IN');
  const walletDiscFormatted = deal.wallet_discount ? Number(parseFloat(deal.wallet_discount).toFixed(2)).toLocaleString('en-IN') : null;
  const specialDiscFormatted = deal.special_discount ? Number(parseFloat(deal.special_discount).toFixed(2)).toLocaleString('en-IN') : null;

  const emailBodyHtml = `
    <h2 style="color:#4A3A5C;margin-top:0">
      ${isRevised ? 'Revised Proforma Invoice' : 'Proforma Invoice'} — ${dealRef}
    </h2>
    <p>Dear <strong>${buyer.company_name || buyer.full_name || 'Valued Member'}</strong>,</p>
    <p style="color:#666">
      ${isRevised 
        ? 'Your deal terms have been updated with revised discounts. Please find attached your updated official Proforma Invoice.' 
        : 'A new deal has been initiated for your material request on WareXhub. Please find attached your official Proforma Invoice.'}
    </p>
    <div style="background:#F3F1F7;border-radius:8px;padding:20px;margin:20px 0;border:1px solid #E5E5E5">
      <table style="width:100%;border-collapse:collapse">
        <tr style="border-bottom:1px solid #e0dbe8">
          <td style="padding:8px 0;color:#666;font-size:13px">Deal Reference</td>
          <td style="padding:8px 0;font-family:monospace;font-weight:700;color:#4A3A5C;font-size:15px">${dealRef}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0dbe8">
          <td style="padding:8px 0;color:#666;font-size:13px">Quantity</td>
          <td style="padding:8px 0;font-weight:600">${deal.quantity || 1}</td>
        </tr>
        ${walletDiscFormatted ? `
        <tr style="border-bottom:1px solid #e0dbe8">
          <td style="padding:8px 0;color:#666;font-size:13px">Wallet Discount Applied</td>
          <td style="padding:8px 0;color:#10B981;font-weight:600">- NPR ${walletDiscFormatted}</td>
        </tr>` : ''}
        ${specialDiscFormatted ? `
        <tr style="border-bottom:1px solid #e0dbe8">
          <td style="padding:8px 0;color:#666;font-size:13px">Special Discount Applied</td>
          <td style="padding:8px 0;color:#10B981;font-weight:600">- NPR ${specialDiscFormatted}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:10px 0 4px 0;color:#1A1A1A;font-weight:700;font-size:14px">Total Deal Payable Amount</td>
          <td style="padding:10px 0 4px 0;font-weight:700;font-size:17px;color:#4A3A5C">NPR ${finalPriceFormatted}</td>
        </tr>
      </table>
    </div>

    <div style="text-align:center;margin:24px 0">
      <a href="${(process.env.FRONTEND_URL || 'https://www.warexhub.com').replace(/\/$/, '')}/dashboard/my-requests" target="_blank"
        style="display:inline-block;background:#4A3A5C;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">
        View & Track in WareXhub Dashboard →
      </a>
    </div>

    <p style="color:#666;font-size:12px;background:#FAF8FC;border:1px dashed #D9D0E5;border-radius:6px;padding:10px 14px;margin:16px 0">
      📎 <strong>PDF Attachment:</strong> Your official Proforma Invoice (<code>WareXhub_Proforma_${dealRef}.pdf</code>) is attached directly to this email.
    </p>

    <p style="color:#666;font-size:13px;line-height:1.5">
      Please review the attached terms and bank remittance details. You may contact our team at 
      <a href="mailto:${ADMIN}" style="color:#4A3A5C;font-weight:600">${ADMIN}</a> or <strong>+977-9801827285</strong> for any clarifications.
    </p>
  `;

  // 1. Send to Buyer
  await sendEmail({
    from: FROM_DEALS,
    to: buyer.email,
    subject: subjectText,
    attachments,
    html: baseTemplate(emailBodyHtml)
  });

  // 2. Also send review copy to Admin (Disabled during active testing)
  if (process.env.SEND_ADMIN_DEAL_COPY === 'true' && buyer.email !== ADMIN) {
    await sendEmail({
      from: FROM_DEALS,
      to: ADMIN,
      subject: `📋 [ADMIN REVIEW] ${subjectText} — ${buyer.company_name || buyer.full_name}`,
      attachments,
      html: baseTemplate(`
        <div style="background:#EEF2FF;border:1px solid #C7D2FE;border-radius:8px;padding:12px 16px;margin-bottom:20px">
          <strong style="color:#3730A3">👑 Admin Review Notification:</strong>
          <p style="margin:4px 0 0;font-size:12px;color:#4338CA">
            A Proforma Invoice has been dispatched to <strong>${buyer.company_name || buyer.full_name} (${buyer.email})</strong>. A copy of the generated PDF is attached for administrative review.
          </p>
        </div>
        ${emailBodyHtml}
      `)
    });
  }
}

module.exports = {
  sendNewRegistrationAlert,
  sendApprovalEmail,
  sendRejectionEmail,
  sendListingApprovedEmail,
  sendListingCorrectionEmail,
  sendNewListingAlert,
  sendMembershipRequestAlert,
  sendGuestThankYouEmail,
  sendNewLeadAlert,
  sendContactFormAlert,
  sendContactFormThankYou,
  sendPasswordChangedEmail,
  sendForgotPasswordEmail,
  sendAdminForgotPasswordAlert,
  sendSuspensionEmail,
  sendNotifyMeAlert,
  sendProformaToBuyerEmail
}
