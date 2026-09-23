 const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

 const getOTPExpiry = (minutes = 10) => {
  return new Date(Date.now() + minutes * 60 * 1000);
};
 const sendOTP = async (mobile, otp) => {
  console.log(`[SMS Sent] Mobile: ${mobile}, OTP: ${otp}`);
  return true;
};
module.exports = { generateOTP, getOTPExpiry, sendOTP };