# Nepali prompt review

**What this is.** The 100 sentences a signer is shown during data collection.
Each is displayed in Nepali, and the signer produces the **Nepali Sign Language
equivalent of that sentence**. They are not answering it — shown *"What is your
name?"* a signer signs the NSL for *"What is your name?"*, not their own name.
Every signer renders the same sentence, which is what makes the samples
comparable across people.

**What we need checked — one thing only.** Does the Nepali say the same as the
English? The English is the reference the model is scored against, so if the
Nepali drifts, the signer produces NSL for a sentence that is not the reference,
and the sample is mislabelled. Nothing downstream would catch that.

We are **not** asking whether a sentence is a natural thing to say, or how it
should be signed. NDFN reviews phrasing and readability for Deaf signers
separately — a different question, and a different reviewer.

**How to mark it.** Leave *Correction* blank if the Nepali is right; write the
corrected Nepali if it is not. Use *Notes* for anything uncertain.

**One question to flag.** Sentence 2 contains a literal `[Name]` / `[नाम]`
placeholder. What should a signer do with it — and would the sentence be better
reworded to avoid a placeholder entirely?

---


## A — Declarative

*Statements. 20 sentences.*

| # | English | Nepali (draft) | Correction | Notes |
| --- | --- | --- | --- | --- |
| 1 | I am going home. | म घर जाँदैछु। |  |  |
| 2 | My name is [Name]. | मेरो नाम [नाम] हो। |  |  |
| 3 | The school is open. | विद्यालय खुला छ। |  |  |
| 4 | I like coffee. | मलाई कफी मन पर्छ। |  |  |
| 5 | It is a sunny day. | आज घमाइलो दिन छ। |  |  |
| 6 | The bus is late. | बस ढिलो भयो। |  |  |
| 7 | I have a pen. | मसँग कलम छ। |  |  |
| 8 | We are learning. | हामी सिक्दैछौं। |  |  |
| 9 | The water is cold. | पानी चिसो छ। |  |  |
| 10 | I see a mountain. | म हिमाल देख्छु। |  |  |
| 11 | She is reading a book. | उनी किताब पढ्दैछिन्। |  |  |
| 12 | He is at the market. | उनी बजारमा छन्। |  |  |
| 13 | The room is quiet. | कोठा शान्त छ। |  |  |
| 14 | We are in Kathmandu. | हामी काठमाडौंमा छौं। |  |  |
| 15 | The teacher is busy. | शिक्षक व्यस्त हुनुहुन्छ। |  |  |
| 16 | My brother is tall. | मेरो दाइ अग्लो छन्। |  |  |
| 17 | The food is ready. | खाना तयार छ। |  |  |
| 18 | I feel happy today. | आज म खुसी छु। |  |  |
| 19 | The sky is clear. | आकाश सफा छ। |  |  |
| 20 | This is my house. | यो मेरो घर हो। |  |  |

## B — Interrogative

*Questions. 20 sentences.*

| # | English | Nepali (draft) | Correction | Notes |
| --- | --- | --- | --- | --- |
| 21 | What is your name? | तपाईंको नाम के हो? |  |  |
| 22 | Where is the hospital? | अस्पताल कहाँ छ? |  |  |
| 23 | Are you hungry? | तपाईंलाई भोक लाग्यो? |  |  |
| 24 | Can you help me? | के तपाईं मलाई सहयोग गर्न सक्नुहुन्छ? |  |  |
| 25 | When does the shop open? | पसल कहिले खुल्छ? |  |  |
| 26 | How do I get to Kathmandu? | काठमाडौं कसरी पुग्ने? |  |  |
| 27 | Is this your bag? | के यो तपाईंको झोला हो? |  |  |
| 28 | Who is that person? | त्यो व्यक्ति को हो? |  |  |
| 29 | Why are you late? | तपाईं किन ढिलो हुनुभयो? |  |  |
| 30 | Do you know sign language? | के तपाईंलाई सांकेतिक भाषा आउँछ? |  |  |
| 31 | Where are you going? | तपाईं कहाँ जाँदै हुनुहुन्छ? |  |  |
| 32 | What time is it? | अहिले कति बज्यो? |  |  |
| 33 | Can I sit here? | के म यहाँ बस्न सक्छु? |  |  |
| 34 | Is the bus coming? | बस आउँदैछ? |  |  |
| 35 | Do you live here? | के तपाईं यहाँ बस्नुहुन्छ? |  |  |
| 36 | Are you a student? | के तपाईं विद्यार्थी हुनुहुन्छ? |  |  |
| 37 | Which road should I take? | मैले कुन बाटो जानुपर्छ? |  |  |
| 38 | When will you return? | तपाईं कहिले फर्कनुहुन्छ? |  |  |
| 39 | Can you repeat that? | के तपाईं फेरि भन्न सक्नुहुन्छ? |  |  |
| 40 | Is the water safe to drink? | के यो पानी पिउन सुरक्षित छ? |  |  |

## C — Negation

*Negated statements. 20 sentences.*

| # | English | Nepali (draft) | Correction | Notes |
| --- | --- | --- | --- | --- |
| 41 | I do not understand. | म बुझ्दिनँ। |  |  |
| 42 | I don't want sugar. | मलाई चिनी चाहिँदैन। |  |  |
| 43 | No, that is wrong. | होइन, त्यो गलत हो। |  |  |
| 44 | The doctor is not here. | डाक्टर यहाँ हुनुहुन्न। |  |  |
| 45 | I cannot sign fast. | म छिटो सङ्केत गर्न सक्दिनँ। |  |  |
| 46 | There is no more rice. | अब भात छैन। |  |  |
| 47 | I didn't see the car. | मैले गाडी देखिनँ। |  |  |
| 48 | He is not my brother. | उनी मेरो दाइ होइनन्। |  |  |
| 49 | I don't like spicy food. | मलाई पिरो खाना मन पर्दैन। |  |  |
| 50 | It is not raining. | पानी परिरहेको छैन। |  |  |
| 51 | She is not at home. | उनी घरमा छैनन्। |  |  |
| 52 | I do not agree. | म सहमत छैनँ। |  |  |
| 53 | The store is not open. | पसल खुलेको छैन। |  |  |
| 54 | We cannot wait longer. | हामी अझै पर्खन सक्दैनौं। |  |  |
| 55 | There is no money left. | पैसा बाँकी छैन। |  |  |
| 56 | He did not come today. | उनी आज आएनन्। |  |  |
| 57 | This is not mine. | यो मेरो होइन। |  |  |
| 58 | I am not ready. | म तयार छैनँ। |  |  |
| 59 | They are not coming. | तिनीहरू आउँदैनन्। |  |  |
| 60 | I cannot go now. | म अहिले जान सक्दिनँ। |  |  |

## D — Temporal

*Time reference. 20 sentences.*

| # | English | Nepali (draft) | Correction | Notes |
| --- | --- | --- | --- | --- |
| 61 | I went yesterday. | म हिजो गएँ। |  |  |
| 62 | We will meet tomorrow. | हामी भोलि भेट्नेछौं। |  |  |
| 63 | I woke up at 7 AM. | म बिहान सात बजे उठें। |  |  |
| 64 | Next week is a holiday. | अर्को हप्ता बिदा छ। |  |  |
| 65 | Last year I was a student. | गत वर्ष म विद्यार्थी थिएँ। |  |  |
| 66 | I will finish soon. | म चाँडै सक्नेछु। |  |  |
| 67 | Before I eat, I wash hands. | खानुअघि म हात धुन्छु। |  |  |
| 68 | After the movie, I went home. | फिल्मपछि म घर गएँ। |  |  |
| 69 | Monday is a busy day. | सोमबार व्यस्त दिन हो। |  |  |
| 70 | It takes two hours. | दुई घण्टा लाग्छ। |  |  |
| 71 | I will arrive in the evening. | म बेलुका आइपुग्नेछु। |  |  |
| 72 | She came before lunch. | उनी खाजाअघि आइन्। |  |  |
| 73 | We studied after class. | हामीले कक्षापछि पढ्यौं। |  |  |
| 74 | The meeting starts at 9 AM. | बैठक बिहान नौ बजे सुरु हुन्छ। |  |  |
| 75 | I left early this morning. | म आज बिहान सबेरै हिँडें। |  |  |
| 76 | The shop closes at 5 PM. | पसल बेलुका पाँच बजे बन्द हुन्छ। |  |  |
| 77 | I will call you later. | म तपाईंलाई पछि फोन गर्नेछु। |  |  |
| 78 | We finished the task yesterday. | हामीले हिजो काम सक्यौं। |  |  |
| 79 | He will travel next month. | उनी अर्को महिना यात्रा गर्नेछन्। |  |  |
| 80 | I eat breakfast before class. | म कक्षाअघि बिहानको खाना खान्छु। |  |  |

## E — Utility

*Everyday requests and needs. 20 sentences.*

| # | English | Nepali (draft) | Correction | Notes |
| --- | --- | --- | --- | --- |
| 81 | I need a doctor now. | मलाई अहिले डाक्टर चाहियो। |  |  |
| 82 | Where is the emergency room? | आपतकालीन कक्ष कहाँ छ? |  |  |
| 83 | I lost my wallet. | मेरो पर्स हरायो। |  |  |
| 84 | Please call an interpreter. | कृपया दोभाषे बोलाउनुहोस्। |  |  |
| 85 | I am allergic to medicine. | मलाई औषधिको एलर्जी छ। |  |  |
| 86 | There is a fire. | आगलागी भयो। |  |  |
| 87 | I am feeling dizzy. | मलाई रिंगटा लागिरहेको छ। |  |  |
| 88 | Please write it down. | कृपया लेखिदिनुस्। |  |  |
| 89 | Where is the police station? | प्रहरी चौकी कहाँ छ? |  |  |
| 90 | I need help with this form. | मलाई यो फारम भर्न सहयोग चाहियो। |  |  |
| 91 | I need water. | मलाई पानी चाहियो। |  |  |
| 92 | Please help me. | कृपया मलाई सहयोग गर्नुहोस्। |  |  |
| 93 | I missed my bus. | मेरो बस छुट्यो। |  |  |
| 94 | My phone is not working. | मेरो फोन चलिरहेको छैन। |  |  |
| 95 | Can you show me the way? | के तपाईं मलाई बाटो देखाउन सक्नुहुन्छ? |  |  |
| 96 | I need to go to the hospital. | मलाई अस्पताल जानुछ। |  |  |
| 97 | Please speak slowly. | कृपया बिस्तारै बोल्नुस्। |  |  |
| 98 | I do not feel well. | मलाई सन्चो छैन। |  |  |
| 99 | My child is sick. | मेरो बच्चा बिरामी छ। |  |  |
| 100 | I need urgent assistance. | मलाई तत्काल सहयोग चाहियो। |  |  |

---

*100 sentences, 5 categories of 20. Drafted in-project by machine translation; not yet reviewed by a native speaker.*
