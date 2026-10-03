# Networks 101: assignment set for usability simulation

A plausible first course in social network analysis taught with Org Signal. Each assignment is written the way an instructor would hand it out, with what a correct answer contains, so simulated students can be checked for both usability and correctness. Students have no prior network vocabulary unless an earlier assignment taught it.

## A1. Your first network (week 1)
Draw the network of 8 characters from a short story you know (or invent one): who talks to whom. Add a name for everyone. Then find (a) the person with the most ties, (b) the person who connects two groups, (c) how many ties the network has. Submit a screenshot and the three answers.
*Correct answer contains:* a drawn network with 8 labeled people; degree read from the People view; a bridge identified from betweenness (or by eye, then checked with betweenness); tie count from the Network header.

## A2. Measures by hand vs by machine (week 2)
Draw a 6-person path (A-B-C-D-E-F) and a 6-person star. Compute degree, betweenness and closeness by hand for both, then check against Org Signal. Explain any difference (normalization!).
*Correct answer contains:* hand values; app values; recognition that the app normalizes betweenness by (n-1)(n-2) and uses harmonic closeness; the star center has betweenness 1 (normalized).

## A3. Your ego network (week 3)
Run the ego-network interview on yourself: at least two name-generator questions (e.g. "discuss important matters", "socialize with"), 8-15 people, describe each (relationship, closeness), then say who knows whom. Report your network's size, density, effective size and constraint, and write two sentences on whether your network is "closed" or "brokering".
*Correct answer contains:* ego measures from the profile/ego panel; a correct reading (high constraint = closed, low = brokering).

## A4. Class friendship survey (week 4)
The instructor shares a roster survey. Each student answers who they are friends with (and how close, 1-5). The instructor recombines the responses. Students then: find the groups (communities), say whether friendship stays within majors (homophily), and compare "union" vs "reciprocated only" networks.
*Correct answer contains:* communities; assortativity by major with the random-network comparison read correctly; a sentence on how reciprocation changes the network.

## A5. Generated organizations (week 5)
Generate two 120-person workplaces: "distributed" and "bridge-dependent". For each, find the top 5 brokers and check how stable that ranking is. Read the recovery check: did the measures find the planted brokers? Explain why the bridge-dependent org is fragile.
*Correct answer contains:* brokers by betweenness; rank-stability intervals; the recovery check's verdicts quoted; the departure shift found in the Time view.

## A6. Silos (week 6)
Generate a "siloed" workplace. Show with the Groups view whether departments are siloed (E-I index, mixing matrix) and when the silo formed (Time view).
*Correct answer contains:* negative E-I and its comparison to random expectation; the shift detected near the planted date.

## A7. Real data: your own messages (week 7, optional/privacy-aware)
Import one of your own exports (WhatsApp chat, LinkedIn connections, Gmail, X archive), or the instructor's sample exports if you prefer not to. Describe what this kind of data can and cannot show (one person's slice!). Find who connects different parts of your life.
*Correct answer contains:* the import report's "can / cannot show" lines quoted; acknowledgement that betweenness is not meaningful in a one-person export; ego measures used instead.

## A8. Construction choices (week 8)
Using a Slack-like generated dataset, build the network three ways (replies only; replies + mentions; everything including reactions) and report how the top 5 central people change. Which construction would you defend, and why?
*Correct answer contains:* settings changed in the construction drawer; the rebuild summary; a reasoned choice.

## A9. Diffusion (week 9)
In a generated online network with text, find a term that spread. Did adopters mostly have an earlier-adopting neighbor? Compare with the shuffled-time baseline.
*Correct answer contains:* the diffusion view's exposed share vs the null expectation, read correctly.

## A10. Change over time (week 10)
Generate a "reorg-midpoint" workplace. Find when the reorg happened and what changed (ties dissolved, cross-group ties), using the Time view's before/after comparison.

## A11. Perceived networks (week 11)
Four students each draw the whole friendship network of a 10-person group as they perceive it (perceived networks builder). Compute the consensus network and each student's accuracy. Who perceives the network best?

## A12. Final project (week 12)
Pick any dataset (generated, survey, or own export), state a question, build the network with defended settings, analyze it with at least three measures and one statistical comparison, export the network to Gephi (GEXF) and the methods appendix, and write a 1-page report.
*Correct answer contains:* the methods appendix, GEXF that opens in Gephi/networkx, claims that match the app's numbers.
