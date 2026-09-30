const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const NepaliDatePkg = require('nepali-date-converter');
const NepaliDate = NepaliDatePkg.default || NepaliDatePkg;

/**
 * Number to Words converter (Nepali / Indian format)
 */
function numberToWords(num) {
  const a = [
    '', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ',
    'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  num = Math.round(Number(num) || 0);
  if (num === 0) return 'Zero Rupees Only';

  function inWords(n) {
    if (n === 0) return '';
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + ' ' + a[n % 10];
    if (n < 1000) return a[Math.floor(n / 100)] + 'Hundred ' + inWords(n % 100);
    if (n < 100000) return inWords(Math.floor(n / 1000)) + 'Thousand ' + inWords(n % 1000);
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + 'Lakh ' + inWords(n % 100000);
    return inWords(Math.floor(n / 10000000)) + 'Crore ' + inWords(n % 10000000);
  }

  let words = inWords(num).trim();
  return words + ' Rupees Only';
}

/**
 * Format currency with commas
 */
function formatNPR(amount) {
  const val = parseFloat(amount) || 0;
  return Number(val.toFixed(2)).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Format Date to DD/MM/YYYY strictly
 */
function formatDate(d = new Date()) {
  const date = new Date(d);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Format Nepali (Bikram Sambat) Date to DD/MM/YYYY
 */
function formatNepaliDate(d = new Date()) {
  try {
    const nepaliDate = new NepaliDate(new Date(d));
    return nepaliDate.format('DD/MM/YYYY');
  } catch (e) {
    return '';
  }
}

function formatDateTime(d = new Date()) {
  const date = new Date(d);
  const dateStr = formatDate(date);
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  const secs = String(date.getSeconds()).padStart(2, '0');
  return `${dateStr} ${hours}:${mins}:${secs}`;
}

/**
 * Draw WareXhub Exact Header with Real Logo Asset & Future Techniques corporate details
 */
function drawHeader(doc, top = 35) {
  const left = 36;

  doc.save();

  // 1. Real Logo Asset Embedding
  const logoPath = path.join(__dirname, '../../assets/logo.png');
  let drewImage = false;
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, left, top - 2, { height: 35, fit: [145, 35] });
      drewImage = true;
    } catch (e) { }
  }

  if (!drewImage) {
    doc.lineWidth(2.5).strokeColor('#4A3A5C');
    doc.moveTo(36, top).lineTo(43, top + 17).lineTo(50, top + 5).lineTo(57, top + 17).lineTo(64, top).stroke();
    doc.lineWidth(2).strokeColor('#F59E0B');
    doc.moveTo(42, top + 3).lineTo(58, top + 13).stroke();
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#4A3A5C').text('WareXhub', 70, top + 12);
  }

  // Unit of Future Techniques P. Ltd. directly under the logo
  doc.font('Helvetica').fontSize(8.5).fillColor('#4A3A5C').text('A unit of Future Techniques P. Ltd.', left, top + 38);

  // Right Header: Future Techniques P. Ltd. & Contact Info
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#4A3A5C').text('Future Techniques P. Ltd.', 320, top + 2, { align: 'left' });
  doc.font('Helvetica').fontSize(7.5).fillColor('#333333');
  doc.text('Aspen Marg, Maitighar, St.Xavier College Rd, Kathmandu, Nepal', 320, top + 15);
  doc.text('Contact No : +977 14239555', 320, top + 25);
  doc.text('Email us : info@ftpl.com.np', 320, top + 35);
  doc.text('Website : www.futuretechniques.com.np', 320, top + 45);

  doc.restore();
}

/**
 * Generate fully dynamic, multi-item responsive Proforma PDF strictly matching WarexHub Perfoma.pdf
 */
function generateProformaPdf({ deal, buyer, seller, listing, items = [], bankDetails, printedBy = 'WareXhub Team' }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 36,
        bufferPages: true,
        autoFirstPage: true,
        info: {
          Title: `Proforma - ${deal?.deal_id || 'PROFORMA'}`,
          Author: 'WareXhub / Future Techniques P. Ltd.',
          Subject: 'Official Proforma Invoice',
          Keywords: 'WareXhub, Proforma, B2B'
        }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      const margin = 36;
      const pageWidth = 595.28;
      const pageHeight = 841.89;
      const tableWidth = pageWidth - (margin * 2); // 523.28

      const proformaDate = deal?.proforma_date ? new Date(deal.proforma_date) : new Date();
      const adDateStr = formatDate(proformaDate);
      const bsDateStr = formatNepaliDate(proformaDate);
      const combinedDateStr = bsDateStr ? `${adDateStr}  (${bsDateStr})` : adDateStr;
      const rfqRef = deal?.request_id || deal?.buyer_request_id || listing?.request_id || 'N/A';
      const deliveryAddress = (deal?.delivery_address || buyer?.address || 'Site Delivery / Ex-Works').trim();
      let deliveryTime = (deal?.delivery_time || '').trim();
      if (!deliveryTime && (deal?.delivery_min_days || deal?.delivery_max_days)) {
        const minD = deal.delivery_min_days || 3;
        const maxD = deal.delivery_max_days || 7;
        deliveryTime = minD === maxD ? `${minD} Working Days` : `${minD}-${maxD} Working Days`;
      }
      if (!deliveryTime) {
        deliveryTime = '3-7 Working Days';
      }

      // ── Normalize Dynamic Items Array ──
      let dealItems = [];
      if (Array.isArray(items) && items.length > 0) {
        dealItems = items.map((it, idx) => ({
          sn: idx + 1,
          description: it.description || it.product_name || it.item_name || it.title || it.name || listing?.name || 'Industrial Material',
          oem: it.oem || it.oem_part_no || it.part_number || it.part_sku || it.sku || '',
          quantity: parseFloat(it.quantity) || 1,
          unitPrice: parseFloat(it.unitPrice || it.unit_price || it.price) || 0,
          walletDiscount: parseFloat(it.walletDiscount || it.wallet_discount || it.discount_amount) || 0,
          specialDiscount: parseFloat(it.specialDiscount || it.special_discount) || 0,
        }));
      } else {
        dealItems = [{
          sn: 1,
          description: listing?.name || deal?.listing_name || 'Industrial Material',
          oem: listing?.oem || listing?.oem_part_no || listing?.sku || '',
          quantity: parseFloat(deal?.quantity) || 1,
          unitPrice: parseFloat(deal?.unit_price) || parseFloat(deal?.base_amount) || 0,
          walletDiscount: parseFloat(deal?.wallet_discount) || 0,
          specialDiscount: parseFloat(deal?.special_discount) || 0,
        }];
      }

      // Check if special discount is applicable (A4: Conditional Special Discount)
      const specialDiscTotal = parseFloat(deal?.special_discount) || dealItems.reduce((s, i) => s + (i.specialDiscount || 0), 0);
      const hasSpecialDiscount = specialDiscTotal > 0;

      // Financials Calculation
      let calculatedBaseAmount = 0;
      let calculatedWalletDiscount = 0;
      let calculatedSpecialDiscount = 0;

      dealItems.forEach(item => {
        const rowBase = item.quantity * item.unitPrice;
        calculatedBaseAmount += rowBase;
        calculatedWalletDiscount += (item.walletDiscount || 0);
        calculatedSpecialDiscount += (item.specialDiscount || 0);
      });

      const baseAmount = parseFloat(deal?.base_amount) || calculatedBaseAmount;
      const walletDisc = parseFloat(deal?.wallet_discount) || calculatedWalletDiscount;
      const specialDisc = hasSpecialDiscount ? (parseFloat(deal?.special_discount) || calculatedSpecialDiscount) : 0;
      const totalDiscount = walletDisc + specialDisc;
      const taxableValue = Math.max(0, baseAmount - totalDiscount);
      const vatAmount = Math.round(taxableValue * 0.13 * 100) / 100;
      const grandTotal = taxableValue + vatAmount;

      // ── Define Clean 5-Column Standard B2B Invoice Table ──
      // Total table width: 523.28pt (36 to 559.28)
      const cols = [
        { key: 'sn', label: 'SN', x: 36, width: 32, align: 'center' },
        { key: 'desc', label: 'Product Description', x: 68, width: 255.28, align: 'left' },
        { key: 'qty', label: 'Qty', x: 323.28, width: 45, align: 'center' },
        { key: 'unitPrice', label: 'Unit Price', x: 368.28, width: 75, align: 'right' },
        { key: 'total', label: 'Amount', x: 443.28, width: 116, align: 'right' }
      ];

      // =======================================================================
      // PAGE 1: HEADER & DYNAMIC METADATA
      // =======================================================================
      drawHeader(doc, 35);

      // Title: "PROFORMA"
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#1A1A1A').text('PROFORMA', 36, 126);

      // ── Dynamic Height Calculation for Header/Customer/Delivery metadata ──
      const buyerCompany = buyer?.company_name || buyer?.full_name || 'Valued Member';
      doc.font('Helvetica-Bold').fontSize(9.5);
      const buyerCompHeight = doc.heightOfString(buyerCompany, { width: 240 });

      // Left Column: Account / Customer Details
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1A1A1A').text('Account/Customer Details', 36, 146);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1A1A1A').text(buyerCompany, 36, 162, { width: 240 });

      let leftCursorY = 162 + buyerCompHeight + 5;
      doc.font('Helvetica').fontSize(8.5).fillColor('#333333');
      doc.text(`VAT/PAN: ${buyer?.vat_number || buyer?.pan_number || '-'}`, 36, leftCursorY);
      leftCursorY += 15;

      const contactPerson = buyer?.full_name || buyer?.contact_person || '-';
      const contactPhone = buyer?.mobile || buyer?.phone || '-';
      doc.text(`Contact: ${contactPerson} (${contactPhone})`, 36, leftCursorY, { width: 240 });
      leftCursorY += 15;

      doc.text(`Email: ${buyer?.email || '-'}`, 36, leftCursorY, { width: 240 });
      leftCursorY += 20;

      // Delivery Address
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1A1A1A').text('Delivery Address:', 36, leftCursorY);
      leftCursorY += 15;

      doc.font('Helvetica').fontSize(8.5).fillColor('#333333');
      doc.text(deliveryAddress, 36, leftCursorY, { width: 240 });
      const delivHeight = doc.heightOfString(deliveryAddress, { width: 240 });
      leftCursorY += delivHeight + 16;

      // Right Column: Contact Details & Order Metadata
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1A1A1A').text('Contact Details :', 320, 146);
      doc.font('Helvetica').fontSize(8.5).fillColor('#333333');
      doc.text('Phone: +977-9801827285', 320, 162);
      doc.text('Email: admin@warexhub.com', 320, 177);
      doc.text('VAT: 610499229', 320, 192);

      let rightCursorY = 214;
      doc.font('Helvetica').fontSize(8.5).fillColor('#333333').text('Order    No   :', 320, rightCursorY);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text(deal?.deal_id || 'PENDING', 395, rightCursorY);
      rightCursorY += 16;

      doc.font('Helvetica').fontSize(8.5).fillColor('#333333').text('Proforma Date :', 320, rightCursorY);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text(combinedDateStr, 395, rightCursorY);
      rightCursorY += 16;

      doc.font('Helvetica').fontSize(8.5).fillColor('#333333').text('Delivery Time :', 320, rightCursorY);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text(deliveryTime, 395, rightCursorY);
      rightCursorY += 16;

      // ── Zero-Hardcoding Dynamic Table Start Y on Page 1 ──
      let tableStartY = Math.max(leftCursorY, rightCursorY, 275) + 6;

      // ── Helper: Draw Table Header ──
      const headerRowHeight = 18;
      const drawBorderedTableHeader = (startY) => {
        // Header background fill
        doc.save();
        doc.rect(36, startY, tableWidth, headerRowHeight).fillColor('#F4F1F8').fill();
        doc.restore();

        // Header text in Bold
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#1A1A1A');
        cols.forEach(c => {
          if (c.align === 'center') {
            doc.text(c.label, c.x, startY + 5, { width: c.width, align: 'center' });
          } else if (c.align === 'right') {
            doc.text(c.label, c.x, startY + 5, { width: c.width - 4, align: 'right' });
          } else {
            doc.text(c.label, c.x + 4, startY + 5, { width: c.width - 6, align: 'left' });
          }
        });

        // Header bottom divider line
        doc.lineWidth(0.5).strokeColor('#1A1A1A').moveTo(36, startY + headerRowHeight).lineTo(36 + tableWidth, startY + headerRowHeight).stroke();
      };

      // Draw table header on Page 1
      drawBorderedTableHeader(tableStartY);

      let rowY = tableStartY + headerRowHeight;
      let tablePageStartY = tableStartY;

      // ── Render Rows ──
      dealItems.forEach((item, idx) => {
        const descCol = cols.find(c => c.key === 'desc');
        const descText = item.oem ? `${item.description} (Part: ${item.oem})` : item.description;
        doc.font('Helvetica').fontSize(8);
        const textH = doc.heightOfString(descText, { width: descCol.width - 8 });
        const rowHeight = Math.max(18, textH + 8);

        // Check if row overflows page
        if (rowY + rowHeight > pageHeight - 75) {
          // Close outer border of current table segment on this page
          const segHeight = rowY - tablePageStartY;
          doc.lineWidth(0.5).strokeColor('#1A1A1A').rect(36, tablePageStartY, tableWidth, segHeight).stroke();
          // Draw vertical divider lines for this segment
          cols.slice(1).forEach(c => {
            doc.lineWidth(0.5).strokeColor('#1A1A1A').moveTo(c.x, tablePageStartY).lineTo(c.x, rowY).stroke();
          });

          // Start new page
          doc.addPage();
          drawHeader(doc, 35);
          tablePageStartY = 115;
          drawBorderedTableHeader(tablePageStartY);
          rowY = tablePageStartY + headerRowHeight;
        }

        // Draw Row Data
        doc.font('Helvetica').fontSize(8).fillColor('#1A1A1A');

        // SN
        doc.text(String(item.sn || (idx + 1)), cols[0].x, rowY + 5, { width: cols[0].width, align: 'center' });

        // Description
        doc.text(descText, cols[1].x + 4, rowY + 5, { width: cols[1].width - 8, align: 'left' });

        // Qty
        doc.text(String(item.quantity), cols[2].x, rowY + 5, { width: cols[2].width, align: 'center' });

        // Unit Price
        doc.text(formatNPR(item.unitPrice), cols[3].x, rowY + 5, { width: cols[3].width - 4, align: 'right' });

        // Amount (Qty * Unit Price)
        const rowAmount = item.quantity * item.unitPrice;
        doc.text(formatNPR(rowAmount), cols[4].x, rowY + 5, { width: cols[4].width - 4, align: 'right' });

        // Row bottom divider line
        doc.lineWidth(0.4).strokeColor('#D8D4E2').moveTo(36, rowY + rowHeight).lineTo(36 + tableWidth, rowY + rowHeight).stroke();

        rowY += rowHeight;
      });

      // ── Complete the Table Border and Vertical Column Dividers ──
      const finalTableHeight = rowY - tablePageStartY;
      doc.lineWidth(0.5).strokeColor('#1A1A1A').rect(36, tablePageStartY, tableWidth, finalTableHeight).stroke();

      cols.slice(1).forEach(c => {
        doc.lineWidth(0.5).strokeColor('#1A1A1A').moveTo(c.x, tablePageStartY).lineTo(c.x, rowY).stroke();
      });

      // =======================================================================
      // FINANCIAL SUMMARY, BANK DETAILS, AMOUNT IN WORDS & SIGNATURES
      // =======================================================================
      let summaryY = rowY + 8;

      // Check if Summary + Signatures block fits on current page (approx 210pt needed)
      if (summaryY + 210 > pageHeight - 55) {
        doc.addPage();
        drawHeader(doc, 35);
        summaryY = 115;
      }

      // Count lines for summary rows
      let summaryRowCount = 4; // Sub Total, Taxable Value, VAT 13%, Grand Total
      if (walletDisc > 0) summaryRowCount++;
      if (hasSpecialDiscount && specialDisc > 0) summaryRowCount++;
      const summaryBoxHeight = Math.max(78, summaryRowCount * 16);

      // Left: Official Bank Details Box (Strictly dynamic from DB / Admin settings)
      const bank = {
        bank_name: bankDetails?.bank_name || '-',
        account_name: bankDetails?.account_name || '-',
        account_number: bankDetails?.account_number || '-',
        branch: bankDetails?.branch || '-'
      };

      doc.save();
      doc.rect(36, summaryY, 260, summaryBoxHeight).strokeColor('#1A1A1A').lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text(`Bank Details : ${bank.bank_name}`, 44, summaryY + 10);
      doc.font('Helvetica').fontSize(8).fillColor('#333333');
      doc.text(`A/c Name : ${bank.account_name}`, 44, summaryY + 26);
      doc.text(`A/c Number : ${bank.account_number}`, 44, summaryY + 42);
      doc.text(`Branch : ${bank.branch}`, 44, summaryY + 58);
      doc.restore();

      // Right: Financial Summary Breakdown Box with full row lines
      doc.save();
      doc.rect(296, summaryY, 263.28, summaryBoxHeight).strokeColor('#1A1A1A').lineWidth(0.5).stroke();

      let sumLineY = summaryY;
      const rowH = summaryBoxHeight / summaryRowCount;

      // 1. Sub Total
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#1A1A1A').text('Sub Total:', 304, sumLineY + 4);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text(formatNPR(baseAmount), 445, sumLineY + 4, { align: 'right', width: 106 });
      sumLineY += rowH;
      doc.lineWidth(0.4).strokeColor('#E0DBE8').moveTo(296, sumLineY).lineTo(559.28, sumLineY).stroke();

      // 2. Wallet Discount (if any)
      if (walletDisc > 0) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#1A1A1A').text('Wallet Discount:', 304, sumLineY + 4);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#10B981').text(`- ${formatNPR(walletDisc)}`, 445, sumLineY + 4, { align: 'right', width: 106 });
        sumLineY += rowH;
        doc.lineWidth(0.4).strokeColor('#E0DBE8').moveTo(296, sumLineY).lineTo(559.28, sumLineY).stroke();
      }

      // 3. Special Discount (if any)
      if (hasSpecialDiscount && specialDisc > 0) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#1A1A1A').text('Special Discount:', 304, sumLineY + 4);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#10B981').text(`- ${formatNPR(specialDisc)}`, 445, sumLineY + 4, { align: 'right', width: 106 });
        sumLineY += rowH;
        doc.lineWidth(0.4).strokeColor('#E0DBE8').moveTo(296, sumLineY).lineTo(559.28, sumLineY).stroke();
      }

      // 4. Taxable Value
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#1A1A1A').text('Taxable Value:', 304, sumLineY + 4);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text(formatNPR(taxableValue), 445, sumLineY + 4, { align: 'right', width: 106 });
      sumLineY += rowH;
      doc.lineWidth(0.4).strokeColor('#E0DBE8').moveTo(296, sumLineY).lineTo(559.28, sumLineY).stroke();

      // 5. VAT 13%
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#1A1A1A').text('VAT 13%:', 304, sumLineY + 4);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text(formatNPR(vatAmount), 445, sumLineY + 4, { align: 'right', width: 106 });
      sumLineY += rowH;
      doc.lineWidth(0.5).strokeColor('#1A1A1A').moveTo(296, sumLineY).lineTo(559.28, sumLineY).stroke();

      // 6. Grand Total
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text('Grand Total:', 304, sumLineY + 4);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1A1A1A').text(`NPR ${formatNPR(grandTotal)}`, 445, sumLineY + 4, { align: 'right', width: 106 });
      doc.restore();

      // Amount in Words Box
      const wordsBoxY = summaryY + summaryBoxHeight + 8;
      doc.rect(36, wordsBoxY, tableWidth, 20).strokeColor('#1A1A1A').lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#1A1A1A').text('Amount in Words :', 44, wordsBoxY + 6);
      doc.font('Helvetica').fontSize(8).fillColor('#1A1A1A').text(numberToWords(grandTotal), 140, wordsBoxY + 6, { width: 405 });

      // Remarks
      const remY = wordsBoxY + 28;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text('Remarks :  ', 36, remY);
      const reqId = deal?.request_id || deal?.rfq_id || 'N/A';
      const dealId = deal?.deal_id || 'PENDING';
      const remarksText = `RFQ No: ${reqId} / Deal No: ${dealId}`;
      doc.font('Helvetica').fontSize(8.5).fillColor('#333333').text(remarksText, 85, remY);

      // Signatures anchored cleanly towards the bottom above footer
      const sigY = Math.max(remY + 40, 715);

      // 1. Prepared By (Left)
      doc.font('Helvetica').fontSize(7.5).fillColor('#555555').text('Warexhub', 56, sigY - 14);
      doc.lineWidth(0.5).strokeColor('#1A1A1A').moveTo(36, sigY).lineTo(160, sigY).stroke();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text('Prepared By', 56, sigY + 5);

      // 2. Receiver's Signature (Center)
      doc.lineWidth(0.5).strokeColor('#1A1A1A').moveTo(230, sigY).lineTo(360, sigY).stroke();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text("Receiver's Signature", 240, sigY + 5);

      // 3. Authorized Signature (Right)
      doc.lineWidth(0.5).strokeColor('#1A1A1A').moveTo(430, sigY).lineTo(559.28, sigY).stroke();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text('Authorized Signature', 445, sigY + 5);

      // =======================================================================
      // TERMS AND CONDITIONS PAGE
      // =======================================================================
      doc.addPage();
      drawHeader(doc, 35);

      // Title: "Terms and Conditions"
      doc.font('Helvetica-Bold').fontSize(13.5).fillColor('#1A1A1A').text('Terms and Conditions', 36, 104);

      const col1Terms = [
        {
          num: '1.   General Conditions & Applications.',
          sub: [
            { id: 'a.', txt: 'All Quotations and Contracts placed with the Company are subject to these Terms and Conditions. The Company may at any time vary or alter these Terms and Conditions.' },
            { id: 'b.', txt: 'Modifications, additions and/or extensions of these Terms and Conditions, and/or provisions that vary from these Terms and Conditions will be binding on the Company only if agreed between the parties explicitly and in writing.' },
            { id: 'c.', txt: 'The applicability of general or specific terms and conditions and provisions of Customer is expressly rejected by the Company, unless otherwise prior written agreement.' },
            { id: 'd.', txt: 'The Customer to whom these Terms and Conditions apply shall accept these terms for all subsequent Offers as of now presented by the Company, all Contracts that will be concluded and for all other subsequent legal relationship between the Company and the Customer.' },
            { id: 'e.', txt: 'If a customer cancels or alters any order or parts for special products, standard products or services after 3 (three) days from the Order Confirmation, the Company reserves the right to charge to the Customer costs of the special products and materials already acquired for the order, together with costs of the labour and tooling expended to the date of such cancellation or alteration.' }
          ]
        },
        {
          num: '2.   Quotations, Orders and Contracts.',
          sub: [
            { id: 'a.', txt: 'Unless otherwise agreed and indicated under the term "Validity" of the document forwarded by the Company, Quotations validity period is identified as 30 days from the date of Quotation sent.' },
            { id: 'b.', txt: 'Contract is stipulated when the Company receives written confirmation from the Customer of the issued Quotation (e.g. Purchase Order from the Customer), unless the Company shall not revoke its offer within 2 (two) working days of receipt of such confirmation. In case of different assignment methods of the Order, the Contract is stipulated when the written acceptance of the Order (e.g. Order Confirmation) is sent to the Customer by the Company.' },
            { id: 'c.', txt: 'The Company may reserve the right to revoke the Quotation and the Order received from the Customer if the submitted document differs from the Offer presented and/or the product/service requested does not correspond to what was discussed between parties.' },
            { id: 'd.', txt: 'The Company may in its absolute discretion refuse to accept an Order whether received from an existing Customer or a new Customer. The Company will not be liable for any damages, loss or compensation arising from its decision to refuse, to accept or to cancel an Order after it has been received by the Company.' },
            { id: 'e.', txt: 'The Company is not required to provide the Customer for any reason or justification to refuse or cancel the Order pursuant to paragraph d. above. If any materials specified within the Quotation become unavailable prior to delivery or installation, the Company in its absolute discretion may substitute a reasonable alternative as long as it meets the relevant standard.' }
          ]
        },
        {
          num: '3.   Pricing.',
          sub: [
            { id: 'a.', txt: 'Unless otherwise stated, all prices are in Nepali Currency (NPR). Pricing does not include Ex-Works/ Warehouse unless otherwise stated, all prices are exclusive of VAT, any costs related to activities done by third parties.' },
            { id: 'b.', txt: 'Transit & Insurance of goods is not included & should be done by customer. Company will be not responsible/liable for any damage done.' },
            { id: 'c.', txt: 'For special products quoted that needs to be defined with the Customer final construction drawings. Prices quoted in the initial Offer, in this case, are subject to any type of modification based on the choices made subsequently between the parties and the final constructional drawings realized by the Company and confirmed by the Customer.' },
            { id: 'd.', txt: 'If there is any error or omission in the Quotation, the Company reserves the right to amend the Quotation price. This clause applies even if it has been accepted by the Customer. In this case the Company will emits a new updated Quotation.' },
            { id: 'e.', txt: 'Price differences between Quotations issued for the same products may be due to increases in wage costs and/or changes in other costs of manufacturing or on raw material acquisition.' }
          ]
        }
      ];

      const col2Terms = [
        {
          num: '4.   Terms of Payment.',
          sub: [
            { id: 'a.', txt: 'Payments due to Company are to be made, without retention, within the term fixed in the Quotation and following documents.' },
            { id: 'b.', txt: 'Payment will be considered done when the funds are cleared in the Company’s nominated bank account.' },
            { id: 'c.', txt: 'Products will be delivered to the place or places specified in the Order and in terms cited in the Quotation and confirmed in the Order Confirmation, once the payment terms fulfilled.' },
            { id: 'd.', txt: 'If the Customer fails to make payment in accordance with the terms, the Company will be entitled to: • charge default interest at the rate of 10% per annum on all overdue amounts calculated daily from the due date; • claim all costs relating to collection; • cease all remaining work until payment is received.' }
          ]
        },
        {
          num: '5.   Installation.',
          sub: [
            { id: 'a.', txt: 'Each Quotation indicates if the installation is included or not. It is responsibility of the Customer to ensure that installation can be completed without any interruption.' },
            { id: 'b.', txt: 'If installation is not included, products delivered need to be installed by the Customer or trained personnel identified by the Customer.' },
            { id: 'c.', txt: 'Afterwards, if the Customer requires installation on Company’s products (only) and this is not agreed upon in the Quotation, it will be quoted separately.' }
          ]
        },
        {
          num: '6.   Warranty.',
          sub: [
            { id: 'a.', txt: 'Warranty is always cited in the Quotation terms.' },
            { id: 'b.', txt: 'During the Warranty period the Customer should give notice in writing to the Company of any faults or defects. The Company shall repair or replace the product without cost to Customer if due to defects.' },
            { id: 'c.', txt: 'On returned goods, parts damaged for poor packaging of the Customer are not covered by Warranty.' }
          ]
        },
        {
          num: '7.   Return.',
          sub: [
            { id: 'a.', txt: 'Customer shall return the goods within 30 days from the Date of Invoice with Valid Reason and following documents attached.' },
            { id: 'b.', txt: 'Customer shall pack goods properly. Damaged goods due to Customer poor handling will not be accepted. Keep original packing for 1 month.' }
          ]
        },
        {
          num: '8.   Delivery Time.',
          sub: [
            { id: 'a.', txt: 'Delivery time of goods depends on product type. Please consult Quotation for delivery time.' },
            { id: 'b.', txt: 'The Company will not be liable for any failure or delay in supply or delivery due to Force Majeure events.' }
          ]
        }
      ];

      // Draw Column 1
      let y1 = 124;
      col1Terms.forEach(t => {
        doc.font('Helvetica-Bold').fontSize(6.2).fillColor('#1A1A1A').text(t.num, 36, y1);
        y1 += 9;
        t.sub.forEach(s => {
          doc.font('Helvetica-Bold').fontSize(5.2).fillColor('#1A1A1A').text(s.id, 42, y1);
          doc.font('Helvetica').fontSize(5.2).fillColor('#333333').text(s.txt, 52, y1, { width: 232, lineGap: 0.9 });
          const textH = doc.heightOfString(s.txt, { width: 232, lineGap: 0.9 });
          y1 += textH + 4;
        });
        y1 += 6;
      });

      // Draw Column 2
      let y2 = 124;
      col2Terms.forEach(t => {
        doc.font('Helvetica-Bold').fontSize(6.2).fillColor('#1A1A1A').text(t.num, 295, y2);
        y2 += 9;
        t.sub.forEach(s => {
          doc.font('Helvetica-Bold').fontSize(5.2).fillColor('#1A1A1A').text(s.id, 301, y2);
          doc.font('Helvetica').fontSize(5.2).fillColor('#333333').text(s.txt, 311, y2, { width: 248, lineGap: 0.9 });
          const textH = doc.heightOfString(s.txt, { width: 248, lineGap: 0.9 });
          y2 += textH + 4;
        });
        y2 += 6;
      });

      // Footer note
      doc.font('Helvetica').fontSize(5.5).fillColor('#444444').text(
        'Note: Terms & Conditions are enclosed with Quotation & thus is integrated part of offer and other documents unless it is agreed in writing specifically.',
        36, 762, { width: tableWidth }
      );

      // ── Post-process Page Numbers & Footers (Buffered Range) ──
      const range = doc.bufferedPageRange();
      const totalPages = range.count;

      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);

        // Header Page Number on all pages (single line right-aligned)
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1A1A1A').text(`Page No : ${i + 1}/${totalPages}`, 430, 95, { width: 129.28, align: 'right' });

        // On Invoice / Table pages: render Printed By footer
        if (i < range.start + range.count - 1) {
          doc.font('Helvetica').fontSize(6.5).fillColor('#666666');
          doc.text('Printed By: WareXhub Team', 36, 782);
          doc.text(`Printed DateTime : ${formatDateTime(new Date())}`, 425, 782);
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateProformaPdf,
  formatNPR,
  formatDate,
  numberToWords
};
