import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import java.awt.Font;

// Minimal Java GUI for testing LiFE Java process detection (java -jar /abs/path.jar).
public class LifeJavaTest {
    public static void main(String[] args) {
        long start = System.currentTimeMillis();
        long pid = ProcessHandle.current().pid();
        System.out.println("LiFE Java Test running, pid " + pid);
        SwingUtilities.invokeLater(() -> {
            JFrame frame = new JFrame("LiFE Java Test");
            JLabel label = new JLabel("", SwingConstants.CENTER);
            label.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 22));
            frame.add(label);
            frame.setSize(420, 200);
            frame.setLocationRelativeTo(null);
            frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
            Timer timer = new Timer(1000, e -> {
                long s = (System.currentTimeMillis() - start) / 1000;
                label.setText(String.format("<html><center>PID %d<br>läuft seit %02d:%02d</center></html>", pid, s / 60, s % 60));
            });
            timer.setInitialDelay(0);
            timer.start();
            frame.setVisible(true);
        });
    }
}
